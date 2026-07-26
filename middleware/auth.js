const net = require('net');
const tools = require('../app/tools');

function isLocalhost(req) {
  const ip = (req.ip || req.socket.remoteAddress || '').replace(/^\[|]$/g, '');
  if (ip === 'localhost') return true;
  if (ip === '::1') return true;
  if (ip.startsWith('::ffff:127.')) return true;
  if (net.isIP(ip) === 4 && ip.startsWith('127.')) return true;
  return false;
}

function authMiddleware(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (isLocalhost(req)) {
    return next();
  }
  // Allow /mailq access if Key query param is valid or MailKey cookie is valid
  if (req.path.startsWith('/mailq')) {
    if (req.query.Key) {
      // Temporarily set the cookie to validate the key
      req.cookies.MailKey = req.query.Key;
      if (tools.isValid(req, 'mailq')) {
        return next();
      }
      // Invalid key provided explicitly - reject and clear any existing cookie
      delete req.cookies.MailKey;
      if (req.xhr) {
        return res.status(401).json({ error: 'Invalid access key.' });
      }
      return res.redirect('/');
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
module.exports.isLocalhost = isLocalhost;
