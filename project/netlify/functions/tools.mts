import type { Config, Context } from "@netlify/functions";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { unzipSync } from "fflate";
import { db } from "../../db/index.js";
import { operations } from "../../db/schema.js";
import { trackVisitor } from "../../lib/visitor.js";
import { saveResult, safeFileName } from "../../lib/results.js";

// Serverless request bodies are capped at ~6 MB, so uploads are limited below that
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
// Largest single file that is kept when extracting a ZIP archive
const MAX_EXTRACTED_FILE_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_TOTAL_BYTES = 60 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const ZIP_TYPES = ["application/zip", "application/x-zip-compressed", "application/x-zip"];
const SAFE_ZIP_EXTS = [".pdf", ".txt", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".doc", ".docx", ".xlsx", ".csv"];

const passportPhotoSizes: Record<string, { width: number; height: number; label: string }> = {
  "35x45": { width: 413, height: 531, label: "35 x 45 mm" },
  "2x2": { width: 600, height: 600, label: "2 x 2 in" },
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const savingsOf = (originalSize: number, resultSize: number) =>
  originalSize > 0 ? Math.round((1 - resultSize / originalSize) * 100) : 0;

async function recordOp(sessionId: string, tool: string, originalSize: number, resultSize: number, filename: string, status = "success") {
  try {
    await db.insert(operations).values({
      sessionId,
      tool,
      originalSize,
      resultSize,
      savingsPercent: status === "success" ? savingsOf(originalSize, resultSize) : 0,
      filename,
      status,
    });
  } catch (err) {
    console.error("recordOp error:", (err as Error).message);
  }
}

async function readUpload(form: FormData, field: string, accept: (file: File) => boolean, typeError: string) {
  const file = form.get(field);
  if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "No file provided");
  if (!accept(file)) throw new HttpError(400, typeError);
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "File is too large. The maximum size is 4 MB.");
  return { file, buffer: Buffer.from(await file.arrayBuffer()) };
}

// ─── Tool handlers ────────────────────────────────────────────────────────────
type ToolHandler = (form: FormData) => Promise<{
  resultSize: number;
  body: Record<string, unknown>;
}>;

const compressImage: ToolHandler = async (form) => {
  const { file, buffer } = await readUpload(form, "image", (f) => IMAGE_TYPES.includes(f.type), "Only image files are allowed");
  const quality = Math.min(100, Math.max(1, parseInt(String(form.get("quality"))) || 80));
  const requested = String(form.get("format") || "jpeg");
  const format = ["jpeg", "png", "webp", "avif"].includes(requested) ? requested : "jpeg";

  let image = sharp(buffer, { animated: file.type === "image/gif" });
  const maxW = parseInt(String(form.get("maxWidth"))) || undefined;
  const maxH = parseInt(String(form.get("maxHeight"))) || undefined;
  if (maxW || maxH) image = image.resize(maxW, maxH, { fit: "inside", withoutEnlargement: true });

  switch (format) {
    case "jpeg": image = image.jpeg({ quality, progressive: true }); break;
    case "png":  image = image.png({ compressionLevel: Math.round((100 - quality) / 11), progressive: true }); break;
    case "webp": image = image.webp({ quality }); break;
    case "avif": image = image.avif({ quality }); break;
  }

  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  const downloadUrl = await saveResult(`compressed_${crypto.randomUUID()}.${format}`, data);

  return {
    resultSize: info.size,
    body: {
      originalSize: file.size,
      resultSize: info.size,
      savings: savingsOf(file.size, info.size),
      width: info.width,
      height: info.height,
      format: info.format,
      downloadUrl,
    },
  };
};

const passportPhoto: ToolHandler = async (form) => {
  const size = passportPhotoSizes[String(form.get("size"))];
  if (!size) throw new HttpError(400, "Choose a supported passport photo size");
  const { buffer } = await readUpload(form, "image", (f) => IMAGE_TYPES.includes(f.type), "Only image files are allowed");

  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(size.width, size.height, { fit: "cover", position: sharp.strategy.attention })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95 })
    .withMetadata({ density: 300 })
    .toBuffer({ resolveWithObject: true });

  const downloadUrl = await saveResult(`passport_${crypto.randomUUID()}.jpg`, data);

  return {
    resultSize: info.size,
    body: { width: info.width, height: info.height, size: size.label, downloadUrl },
  };
};

const compressPdf: ToolHandler = async (form) => {
  const { file, buffer } = await readUpload(form, "pdf", (f) => f.type === "application/pdf", "Only PDF files are allowed");
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  // Compression: strip metadata and re-save with object streams
  pdfDoc.setTitle("");
  pdfDoc.setAuthor("");
  pdfDoc.setSubject("");
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer("ToolBox Pro");
  pdfDoc.setCreator("ToolBox Pro");

  const compressed = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
  const downloadUrl = await saveResult(`compressed_${crypto.randomUUID()}.pdf`, compressed);

  return {
    resultSize: compressed.length,
    body: {
      originalSize: file.size,
      resultSize: compressed.length,
      savings: savingsOf(file.size, compressed.length),
      pages: pdfDoc.getPageCount(),
      downloadUrl,
    },
  };
};

const extractZip: ToolHandler = async (form) => {
  const { buffer } = await readUpload(
    form,
    "zip",
    (f) => ZIP_TYPES.includes(f.type) || f.name.toLowerCase().endsWith(".zip"),
    "Only ZIP files are allowed",
  );

  const extName = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");
  const baseName = (p: string) => p.split("/").pop() || "";
  let plannedTotal = 0;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (entry) => {
        const fileName = baseName(entry.name);
        // Security: only extract safe file types, skip hidden files, traversal paths and oversized entries
        const ok =
          SAFE_ZIP_EXTS.includes(extName(fileName)) &&
          !fileName.startsWith(".") &&
          !entry.name.includes("..") &&
          entry.originalSize <= MAX_EXTRACTED_FILE_BYTES &&
          plannedTotal + entry.originalSize <= MAX_EXTRACTED_TOTAL_BYTES;
        if (ok) plannedTotal += entry.originalSize;
        return ok;
      },
    });
  } catch {
    throw new HttpError(400, "This ZIP archive could not be read");
  }

  const files = await Promise.all(
    Object.entries(entries).map(async ([entryPath, data]) => {
      const fileName = baseName(entryPath);
      return {
        originalName: fileName,
        savedName: safeFileName(fileName),
        size: data.length,
        type: extName(fileName).replace(".", "").toUpperCase(),
        downloadUrl: await saveResult(fileName, data),
      };
    }),
  );

  return { resultSize: 0, body: { extractedCount: files.length, files } };
};

const handlers: Record<string, { tool: string; run: ToolHandler }> = {
  "compress-image": { tool: "image_compression", run: compressImage },
  "passport-photo": { tool: "passport_photo", run: passportPhoto },
  "compress-pdf": { tool: "pdf_compression", run: compressPdf },
  "extract-zip": { tool: "zip_extraction", run: extractZip },
};

export default async (req: Request, context: Context) => {
  const handler = handlers[context.params.action];
  if (!handler) return Response.json({ error: "Not found" }, { status: 404 });

  const sessionId = await trackVisitor(req, context);
  let originalName = "";
  let originalSize = 0;

  try {
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "Upload could not be read. Files must be 4 MB or smaller.");
    });
    const firstFile = [...form.values()].find((v): v is File => v instanceof File);
    originalName = firstFile?.name || "";
    originalSize = firstFile?.size || 0;

    const { resultSize, body } = await handler.run(form);
    await recordOp(sessionId, handler.tool, originalSize, resultSize, originalName);
    return Response.json({ success: true, ...body });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) {
      console.error(`Tool ${context.params.action} failed:`, err);
      await recordOp(sessionId, handler.tool, originalSize, 0, originalName, "error");
    }
    const message = err instanceof HttpError ? err.message : `Processing failed: ${(err as Error).message}`;
    return Response.json({ error: message }, { status });
  }
};

export const config: Config = {
  path: "/api/tools/:action",
  excludedPath: "/api/tools/download",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
