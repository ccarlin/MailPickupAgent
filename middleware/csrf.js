const crypto = require('crypto');
const tools = require('../app/tools');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

// Endpoints invoked by non-browser clients that cannot participate in the
// session-token dance. Documented in SECURITY-AUDIT.md (M1).
// - /api/process: localhost-only pickup integration driven by mailServerPickup.bat (curl).
const CSRF_EXEMPT_PATHS = new Set(['/api/process']);

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getRequestToken(req) {
  if (req.body && typeof req.body._csrf === 'string' && req.body._csrf.length > 0) {
    return req.body._csrf;
  }
  const header = req.headers['x-csrf-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  return null;
}

// Session-based CSRF protection (synchronizer-token pattern):
// - A random token is minted once per session and exposed to every view via
//   res.locals.csrfToken.
// - Unsafe methods (POST/PUT/PATCH/DELETE) must echo it back in the `_csrf`
//   body field (HTML forms) or `X-CSRF-Token` header (AJAX).
// - GET/HEAD/OPTIONS/TRACE are safe and pass through.
module.exports = function csrf(req, res, next) {
  if (!req.session) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  const method = (req.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return next();

  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

  const token = getRequestToken(req);
  if (!token || !safeEqual(token, req.session.csrfToken)) {
    tools.logWarn(`CSRF validation failed: ${req.method} ${req.originalUrl} from ${req.ip}`);
    if (req.xhr || req.path.indexOf('/api/') !== -1) {
      return res.status(403).json({ error: 'Invalid CSRF token. Please refresh the page and try again.' });
    }
    return res.status(403).send('403 Forbidden: invalid CSRF token. Please refresh the page and try again.');
  }

  next();
};
