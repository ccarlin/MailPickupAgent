const tools = require('../tools');

function isLocalhost(req) {
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip === '::1' || ip === '::ffff:127.0.0.1' || ip === '127.0.0.1' || ip === 'localhost';
}

function authMiddleware(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (isLocalhost(req)) {
    return next();
  }
  // Allow /mailq access if Key query param is present or MailKey cookie is valid
  if (req.path.startsWith('/mailq')) {
    if (req.query.Key) {
      return next();
    }
    if (tools.isValid(req, 'mailq')) {
      return next();
    }
  }
  // AJAX/XHR requests should get a 401 JSON so client-side code can handle it
  if (req.xhr) {
    return res.status(401).json({ error: 'Authentication required. Please login again.' });
  }
  res.redirect('/login');
}

module.exports = authMiddleware;
