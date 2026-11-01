const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const unzipper = require('unzipper');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { queries } = require('../db/database');

const router = express.Router();

// ─── Multer Setup ─────────────────────────────────────────────────────────────
const createStorage = (dest) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uuidv4()}_${safeName}`);
  }
});

const imageFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
  allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only image files are allowed'), false);
};

const pdfFilter = (req, file, cb) => {
  file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDF files are allowed'), false);
};

const zipFilter = (req, file, cb) => {
  const allowed = ['application/zip', 'application/x-zip-compressed', 'application/x-zip'];
  (allowed.includes(file.mimetype) || file.originalname.endsWith('.zip'))
    ? cb(null, true) : cb(new Error('Only ZIP files are allowed'), false);
};

const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE || '100') * 1024 * 1024;

const imageUpload = multer({ storage: createStorage('uploads/images'), fileFilter: imageFilter, limits: { fileSize: MAX_SIZE } });
const pdfUpload   = multer({ storage: createStorage('uploads/pdfs'),   fileFilter: pdfFilter,   limits: { fileSize: MAX_SIZE } });
const zipUpload   = multer({ storage: createStorage('uploads/zip'),    fileFilter: zipFilter,   limits: { fileSize: MAX_SIZE } });

// ─── Helper: Record operation ─────────────────────────────────────────────────
function recordOp(req, tool, originalSize, resultSize, filename, status = 'success') {
  try {
    const sessionId = req.session?.userId || null;
    const savings = originalSize > 0 ? Math.round((1 - resultSize / originalSize) * 100) : 0;
    queries.insertOperation.run(sessionId, tool, originalSize, resultSize, savings, filename, status);
  } catch (e) {
    console.error('recordOp error:', e.message);
  }
}

// ─── Helper: Safe file cleanup ────────────────────────────────────────────────
function cleanupFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
  }
}

// ─── 1. IMAGE COMPRESSION ────────────────────────────────────────────────────
router.post('/compress-image', imageUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const inputPath = req.file.path;
  const outputName = `compressed_${uuidv4()}.${req.body.format || 'jpeg'}`;
  const outputPath = path.join(__dirname, '..', 'uploads', 'images', outputName);

  try {
    const quality = Math.min(100, Math.max(1, parseInt(req.body.quality) || 80));
    const format = ['jpeg', 'png', 'webp', 'avif'].includes(req.body.format) ? req.body.format : 'jpeg';

    let sharpInstance = sharp(inputPath);

    // Optionally resize
    if (req.body.maxWidth || req.body.maxHeight) {
      const maxW = parseInt(req.body.maxWidth) || undefined;
      const maxH = parseInt(req.body.maxHeight) || undefined;
      sharpInstance = sharpInstance.resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true });
    }

    // Apply format-specific compression
    switch (format) {
      case 'jpeg': sharpInstance = sharpInstance.jpeg({ quality, progressive: true }); break;
      case 'png':  sharpInstance = sharpInstance.png({ compressionLevel: Math.round((100 - quality) / 11), progressive: true }); break;
      case 'webp': sharpInstance = sharpInstance.webp({ quality }); break;
      case 'avif': sharpInstance = sharpInstance.avif({ quality }); break;
    }

    const info = await sharpInstance.toFile(outputPath);
    const originalSize = req.file.size;
    const resultSize = info.size;

    recordOp(req, 'image_compression', originalSize, resultSize, req.file.originalname);
    cleanupFile(inputPath);

    res.json({
      success: true,
      originalSize,
      resultSize,
      savings: Math.round((1 - resultSize / originalSize) * 100),
      width: info.width,
      height: info.height,
      format: info.format,
      downloadUrl: `/api/tools/download?file=${encodeURIComponent(outputName)}&type=image`
    });
  } catch (err) {
    cleanupFile(inputPath);
    cleanupFile(outputPath);
    recordOp(req, 'image_compression', req.file?.size || 0, 0, req.file?.originalname, 'error');
    res.status(500).json({ error: 'Image compression failed: ' + err.message });
  }
});

// ─── 2. PASSPORT PHOTO CREATOR ───────────────────────────────────────────────
const passportPhotoSizes = {
  '35x45': { width: 413, height: 531, label: '35 x 45 mm' },
  '2x2': { width: 600, height: 600, label: '2 x 2 in' }
};

router.post('/passport-photo', imageUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' });

  const size = passportPhotoSizes[req.body.size];
  if (!size) {
    cleanupFile(req.file.path);
    return res.status(400).json({ error: 'Choose a supported passport photo size' });
  }

  const outputName = `passport_${uuidv4()}.jpg`;
  const outputPath = path.join(__dirname, '..', 'uploads', 'images', outputName);

  try {
    const info = await sharp(req.file.path)
      .rotate()
      .resize(size.width, size.height, { fit: 'cover', position: sharp.strategy.attention })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 95 })
      .withMetadata({ density: 300 })
      .toFile(outputPath);

    recordOp(req, 'passport_photo', req.file.size, info.size, req.file.originalname);
    cleanupFile(req.file.path);

    res.json({
      success: true,
      width: info.width,
      height: info.height,
      size: size.label,
      downloadUrl: `/api/tools/download?file=${encodeURIComponent(outputName)}&type=image`
    });
  } catch (err) {
    cleanupFile(req.file.path);
    cleanupFile(outputPath);
    recordOp(req, 'passport_photo', req.file.size, 0, req.file.originalname, 'error');
    res.status(500).json({ error: 'Passport photo creation failed: ' + err.message });
  }
});

// ─── 3. PDF COMPRESSION ──────────────────────────────────────────────────────
router.post('/compress-pdf', pdfUpload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file provided' });

  const inputPath = req.file.path;
  const outputName = `compressed_${uuidv4()}.pdf`;
  const outputPath = path.join(__dirname, '..', 'uploads', 'pdfs', outputName);

  try {
    const pdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

    // Compression: Remove unused objects, strip metadata, optimize
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('ToolBox Pro');
    pdfDoc.setCreator('ToolBox Pro');

    const compressedBytes = await pdfDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 50
    });

    fs.writeFileSync(outputPath, compressedBytes);

    const originalSize = req.file.size;
    const resultSize = compressedBytes.length;

    recordOp(req, 'pdf_compression', originalSize, resultSize, req.file.originalname);
    cleanupFile(inputPath);

    res.json({
      success: true,
      originalSize,
      resultSize,
      savings: Math.round((1 - resultSize / originalSize) * 100),
      pages: pdfDoc.getPageCount(),
      downloadUrl: `/api/tools/download?file=${encodeURIComponent(outputName)}&type=pdf`
    });
  } catch (err) {
    cleanupFile(inputPath);
    cleanupFile(outputPath);
    recordOp(req, 'pdf_compression', req.file?.size || 0, 0, req.file?.originalname, 'error');
    res.status(500).json({ error: 'PDF compression failed: ' + err.message });
  }
});

// ─── 4. ZIP EXTRACTOR (Extract PDFs from ZIP) ─────────────────────────────────
router.post('/extract-zip', zipUpload.single('zip'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No ZIP file provided' });

  const inputPath = req.file.path;
  const extractDir = path.join(__dirname, '..', 'uploads', 'zip', `extract_${uuidv4()}`);
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    const extractedFiles = [];
    let totalOriginalSize = req.file.size;

    await new Promise((resolve, reject) => {
      fs.createReadStream(inputPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry) => {
          const fileName = path.basename(entry.path);
          const ext = path.extname(fileName).toLowerCase();

          // Security: only extract safe file types
          const safeExts = ['.pdf', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.doc', '.docx', '.xlsx', '.csv'];
          if (safeExts.includes(ext) && !fileName.startsWith('.') && !entry.path.includes('..')) {
            const safeFileName = `${uuidv4()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const outputPath = path.join(extractDir, safeFileName);
            entry.pipe(fs.createWriteStream(outputPath))
              .on('finish', () => {
                const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
                extractedFiles.push({
                  originalName: fileName,
                  savedName: safeFileName,
                  size,
                  type: ext.replace('.', '').toUpperCase(),
                  downloadUrl: `/api/tools/download?file=${encodeURIComponent(safeFileName)}&type=zip&dir=${encodeURIComponent(path.basename(extractDir))}`
                });
              });
          } else {
            entry.autodrain();
          }
        })
        .on('finish', resolve)
        .on('error', reject);
    });

    recordOp(req, 'zip_extraction', totalOriginalSize, 0, req.file.originalname);
    cleanupFile(inputPath);

    res.json({
      success: true,
      extractedCount: extractedFiles.length,
      files: extractedFiles
    });
  } catch (err) {
    cleanupFile(inputPath);
    recordOp(req, 'zip_extraction', req.file?.size || 0, 0, req.file?.originalname, 'error');
    res.status(500).json({ error: 'ZIP extraction failed: ' + err.message });
  }
});

// ─── 5. FILE DOWNLOAD ENDPOINT ────────────────────────────────────────────────
router.get('/download', (req, res) => {
  const { file, type, dir } = req.query;

  if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) {
    return res.status(400).json({ error: 'Invalid file parameter' });
  }

  let filePath;
  const baseDir = path.join(__dirname, '..', 'uploads');

  switch (type) {
    case 'image': filePath = path.join(baseDir, 'images', file); break;
    case 'pdf':   filePath = path.join(baseDir, 'pdfs', file); break;
    case 'audio': filePath = path.join(baseDir, 'audio', file); break;
    case 'zip':
      if (!dir || !/^[a-zA-Z0-9_-]+$/.test(dir)) return res.status(400).json({ error: 'Invalid dir' });
      filePath = path.join(baseDir, 'zip', dir, file);
      break;
    default:      return res.status(400).json({ error: 'Invalid type' });
  }

  // Security: Ensure file is within uploads directory
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or expired' });
  }

  res.download(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: 'Download failed' });
    }
  });
});

module.exports = router;
