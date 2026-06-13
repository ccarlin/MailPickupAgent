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
  res.redirect('/login');
}

module.exports = authMiddleware;
