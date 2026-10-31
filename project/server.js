require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const session = require('express-session');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

// Import routes
const toolRoutes = require('./routes/tools');
const adminRoutes = require('./routes/admin');
const statsMiddleware = require('./middleware/stats');

// Initialize DB
const db = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Ensure directories exist ─────────────────────────────────────────────────
const dirs = ['uploads', 'uploads/images', 'uploads/pdfs', 'uploads/audio', 'uploads/zip', 'data', 'public'];
dirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : '*',
  credentials: true
}));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const toolLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many tool requests, please slow down.' }
});

app.use('/api/', generalLimiter);
app.use('/api/tools/', toolLimiter);

// ─── General Middleware ───────────────────────────────────────────────────────
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Sessions ─────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict'
  }
}));

// ─── Serve Static Files ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
}));

// ─── Stats Tracking Middleware ────────────────────────────────────────────────
app.use(statsMiddleware);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/tools', toolRoutes);
app.use('/api/admin', adminRoutes);

// ─── Admin Panel Route ────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── Catch-all for SPA ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Global Error:', err.stack);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

// ─── Cleanup old uploaded files (older than 1 hour) ───────────────────────────
setInterval(() => {
  const uploadDirs = ['uploads/images', 'uploads/pdfs', 'uploads/audio', 'uploads/zip'];
  uploadDirs.forEach(dir => {
    const fullPath = path.join(__dirname, dir);
    if (fs.existsSync(fullPath)) {
      fs.readdirSync(fullPath).forEach(file => {
        const filePath = path.join(fullPath, file);
        const stat = fs.statSync(filePath);
        const ageMs = Date.now() - stat.mtime.getTime();
        if (ageMs > 60 * 60 * 1000) { // 1 hour
          fs.unlinkSync(filePath);
        }
      });
    }
  });
}, 30 * 60 * 1000); // Run every 30 minutes

app.listen(PORT, () => {
  console.log(`\n🚀 ToolBox Pro running at http://localhost:${PORT}`);
  console.log(`🔐 Admin Panel at http://localhost:${PORT}/admin`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;
