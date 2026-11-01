const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'toolbox.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    ip TEXT,
    user_agent TEXT,
    country TEXT,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    tool TEXT NOT NULL,
    original_size INTEGER,
    result_size INTEGER,
    savings_percent REAL,
    filename TEXT,
    status TEXT DEFAULT 'success',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  );

  CREATE TABLE IF NOT EXISTS stats_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    unique_visitors INTEGER DEFAULT 0,
    total_operations INTEGER DEFAULT 0,
    image_compressions INTEGER DEFAULT 0,
    pdf_compressions INTEGER DEFAULT 0,
    pdf_extractions INTEGER DEFAULT 0,
    bytes_saved INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    page TEXT,
    referrer TEXT,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Insert default admin if not exists ──────────────────────────────────────
const bcrypt = require('bcryptjs');
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  console.log('✅ Default admin created: username=admin password=admin123');
}

// ─── Helper queries ───────────────────────────────────────────────────────────
const queries = {
  // Sessions
  upsertSession: db.prepare(`
    INSERT INTO sessions (id, ip, user_agent, first_seen, last_seen)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
  `),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  getTotalSessions: db.prepare('SELECT COUNT(*) as count FROM sessions'),
  getActiveSessions: db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE last_seen > datetime('now', '-30 minutes')`),

  // Operations
  insertOperation: db.prepare(`
    INSERT INTO operations (session_id, tool, original_size, result_size, savings_percent, filename, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getOperationCount: db.prepare('SELECT COUNT(*) as count FROM operations WHERE status = ?'),
  getOperationsByTool: db.prepare(`
    SELECT tool, COUNT(*) as count, SUM(original_size) as total_original, SUM(result_size) as total_result
    FROM operations GROUP BY tool ORDER BY count DESC
  `),
  getRecentOperations: db.prepare(`
    SELECT o.*, s.ip, s.user_agent FROM operations o
    LEFT JOIN sessions s ON o.session_id = s.id
    ORDER BY o.created_at DESC LIMIT ?
  `),

  // Stats
  getDailyStats: db.prepare('SELECT * FROM stats_daily ORDER BY date DESC LIMIT 30'),
  upsertDailyStats: db.prepare(`
    INSERT INTO stats_daily (date, unique_visitors, total_operations)
    VALUES (date('now'), 1, 0)
    ON CONFLICT(date) DO UPDATE SET
      unique_visitors = unique_visitors + 1
  `),

  // Admin
  getAdminByUsername: db.prepare('SELECT * FROM admin_users WHERE username = ?'),
  updateAdminLogin: db.prepare('UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?'),

  // Page views
  insertPageView: db.prepare('INSERT INTO page_views (session_id, page, referrer) VALUES (?, ?, ?)'),

  // Dashboard summary
  getDashboardSummary: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sessions) as total_users,
      (SELECT COUNT(*) FROM sessions WHERE last_seen > datetime('now', '-30 minutes')) as active_users,
      (SELECT COUNT(*) FROM operations WHERE status = 'success') as total_operations,
      (SELECT COALESCE(SUM(original_size - result_size), 0) FROM operations WHERE result_size > 0) as total_bytes_saved
  `)
};

module.exports = { db, queries };
