import type { Config } from "@netlify/functions";
import { resultStore, RESULT_KEY_PATTERN, RESULT_TTL_MS, resultCreatedAt } from "../../lib/results.js";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export default async (req: Request) => {
  const key = new URL(req.url).searchParams.get("file") || "";
  if (!RESULT_KEY_PATTERN.test(key)) return Response.json({ error: "Invalid file parameter" }, { status: 400 });

  const expired = Date.now() - resultCreatedAt(key) > RESULT_TTL_MS;
  const data = expired ? null : await resultStore().get(key, { type: "stream" });
  if (!data) return Response.json({ error: "File not found or expired" }, { status: 404 });

  const fileName = key.split("/")[1];
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  return new Response(data, {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const config: Config = {
  path: "/api/tools/download",
  method: "GET",
};
