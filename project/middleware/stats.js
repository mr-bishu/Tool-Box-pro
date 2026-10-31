const { v4: uuidv4 } = require('uuid');
const { queries } = require('../db/database');

/**
 * Stats tracking middleware - tracks unique sessions and page views
 */
module.exports = (req, res, next) => {
  try {
    // Skip static files and API calls for session tracking
    if (req.path.startsWith('/api/') || req.path.match(/\.(css|js|png|jpg|ico|woff|woff2|svg)$/)) {
      return next();
    }

    // Initialize session ID
    if (!req.session.userId) {
      req.session.userId = uuidv4();
      // Track new unique visitor
      try {
        queries.upsertDailyStats.run();
      } catch (e) { /* ignore */ }
    }

    const sessionId = req.session.userId;
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Upsert session
    queries.upsertSession.run(sessionId, ip, userAgent);

    // Track page view
    if (req.method === 'GET') {
      const referrer = req.headers['referer'] || '';
      queries.insertPageView.run(sessionId, req.path, referrer);
    }

    next();
  } catch (err) {
    // Don't let stats tracking break the request
    console.error('Stats middleware error:', err.message);
    next();
  }
};
