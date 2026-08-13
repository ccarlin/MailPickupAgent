const express = require('express');
const router = express.Router();
const net = require('net');
const rateLimit = require('express-rate-limit');
const tools = require('../app/tools');
const appConfig = require('../config');
const { verifyPassword, hashPassword } = require('../middleware/hash');

function getPasswordHash() {
  if (appConfig.AUTH_PASSWORD_HASH) {
    return appConfig.AUTH_PASSWORD_HASH;
  }
  if (appConfig.AUTH_PASSWORD) {
    const hash = hashPassword(appConfig.AUTH_PASSWORD);
    tools.logWarn('WARNING: AUTH_PASSWORD is stored in plaintext. Replace it with AUTH_PASSWORD_HASH in your config file.');
    tools.logWarn(`  Generated hash: "${hash}"`);
    return hash;
  }
  return hashPassword('admin');
}

const validPassHash = getPasswordHash();
const validUser = appConfig.AUTH_USERNAME || 'admin';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: (req) => {
    const ip = (req.ip || req.socket.remoteAddress || '').replace(/^\[|\]$/g, '');
    return ip === 'localhost' || ip === '::1' || ip.startsWith('::ffff:127.') || (net.isIP(ip) === 4 && ip.startsWith('127.'));
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const retryAfter = Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000);
    const minutes = Math.ceil(retryAfter / 60);
    res.status(429).render('login', {
      error: `Too many login attempts. Try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`
    });
  }
});

router.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password, identifier } = req.body;
  const clientIp = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace(/^\[|\]$/g, '').split(',')[0].trim() || '127.0.0.1';
  if (username === validUser && verifyPassword(password, validPassHash)) {
    return req.session.regenerate((err) => {
      if (err) {
        tools.logError('Error regenerating session on login: ' + err.message, clientIp);
        return res.status(500).render('login', { error: 'Login failed, please try again.' });
      }
      req.session.authenticated = true;
      req.session.loginMeta = {
        ip: clientIp,
        userAgent: (req.get('User-Agent') || 'unknown').slice(0, 250),
        loginTime: new Date().toISOString(),
        identifier: (identifier || '').trim() || undefined
      };
      return res.redirect('/');
    });
  }
  tools.logError(`Failed login attempt for username "${String(username || '').trim() || 'unknown'}" from IP ${clientIp}`, clientIp);
  res.render('login', { error: 'Invalid username or password' });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
