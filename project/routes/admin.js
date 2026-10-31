const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { queries, db } = require('../db/database');

const router = express.Router();

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: 'Unauthorized. Please login.' });
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
router.post('/login',
  [
    body('username').trim().notEmpty().isLength({ max: 50 }).escape(),
    body('password').notEmpty().isLength({ max: 100 })
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid input' });

    const { username, password } = req.body;

    try {
      const admin = queries.getAdminByUsername.get(username);
      if (!admin) {
        // Prevent timing attacks
        await bcrypt.compare(password, '$2a$10$invalidhashpadding000000000000000000000000000000000000');
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, admin.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Regenerate session to prevent fixation
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: 'Session error' });

        req.session.isAdmin = true;
        req.session.adminId = admin.id;
        req.session.adminUsername = admin.username;

        queries.updateAdminLogin.run(admin.id);

        res.json({ success: true, username: admin.username });
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ─── DASHBOARD SUMMARY ────────────────────────────────────────────────────────
router.get('/dashboard', requireAdmin, (req, res) => {
  try {
    const summary = queries.getDashboardSummary.get();
    const opsByTool = queries.getOperationsByTool.all();
    const recentOps = queries.getRecentOperations.all(20);
    const dailyStats = queries.getDailyStats.all();

    res.json({
      success: true,
      summary: {
        totalUsers: summary.total_users,
        activeUsers: summary.active_users,
        totalOperations: summary.total_operations,
        totalBytesSaved: summary.total_bytes_saved || 0
      },
      operationsByTool: opsByTool,
      recentOperations: recentOps.map(op => ({
        id: op.id,
        tool: op.tool,
        filename: op.filename,
        originalSize: op.original_size,
        resultSize: op.result_size,
        savings: op.savings_percent,
        status: op.status,
        ip: op.ip ? op.ip.replace(/\.\d+$/, '.***') : 'N/A', // Partially mask IP for privacy
        userAgent: op.user_agent,
        createdAt: op.created_at
      })),
      dailyStats
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─── SESSIONS / USER DATAGRAM ─────────────────────────────────────────────────
router.get('/sessions', requireAdmin, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;

    const sessions = db.prepare(`
      SELECT
        s.id,
        s.ip,
        s.user_agent,
        s.first_seen,
        s.last_seen,
        COUNT(o.id) as operation_count
      FROM sessions s
      LEFT JOIN operations o ON o.session_id = s.id
      GROUP BY s.id
      ORDER BY s.last_seen DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;

    res.json({
      success: true,
      sessions: sessions.map(s => ({
        ...s,
        ip: s.ip ? s.ip.replace(/\.\d+$/, '.***') : 'N/A'
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

// ─── OPERATIONS LOG ───────────────────────────────────────────────────────────
router.get('/operations', requireAdmin, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const offset = (page - 1) * limit;
    const tool = req.query.tool || null;

    let query = `
      SELECT o.*, s.ip, s.user_agent
      FROM operations o
      LEFT JOIN sessions s ON o.session_id = s.id
      ${tool ? 'WHERE o.tool = ?' : ''}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const params = tool ? [tool, limit, offset] : [limit, offset];
    const ops = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM operations ${tool ? 'WHERE tool = ?' : ''}`).get(...(tool ? [tool] : [])).count;

    res.json({
      success: true,
      operations: ops.map(op => ({
        ...op,
        ip: op.ip ? op.ip.replace(/\.\d+$/, '.***') : 'N/A'
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load operations' });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────
router.get('/stats', requireAdmin, (req, res) => {
  try {
    const stats = {
      daily: queries.getDailyStats.all(),
      tools: queries.getOperationsByTool.all(),
      totalUsers: queries.getTotalSessions.get().count,
      activeUsers: queries.getActiveSessions.get().count,
      successOps: queries.getOperationCount.get('success').count,
      errorOps: queries.getOperationCount.get('error').count
    };
    res.json({ success: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ─── CHANGE ADMIN PASSWORD ────────────────────────────────────────────────────
router.post('/change-password', requireAdmin,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8, max: 100 }).withMessage('Password must be 8-100 characters')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
      const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.adminId);
      const isValid = await bcrypt.compare(req.body.currentPassword, admin.password_hash);
      if (!isValid) return res.status(401).json({ error: 'Current password is incorrect' });

      const newHash = await bcrypt.hash(req.body.newPassword, 12);
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(newHash, req.session.adminId);

      res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
      res.status(500).json({ error: 'Password change failed' });
    }
  }
);

// ─── AUTH CHECK ───────────────────────────────────────────────────────────────
router.get('/check-auth', (req, res) => {
  res.json({
    authenticated: !!req.session?.isAdmin,
    username: req.session?.adminUsername || null
  });
});

module.exports = router;
