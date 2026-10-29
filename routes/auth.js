const express = require('express');
const router = express.Router();
const net = require('net');
const crypto = require('crypto');
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

const DEVICE_COOKIE = 'mpa_device';
const DEVICE_NAME_COOKIE = 'mpa_device_name';
const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;
const cookieSecure = !!(appConfig.CERT_PATH && appConfig.CERT_KEY_PATH);

function isValidDeviceId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getOrCreateDeviceId(req, res) {
  const existing = req.cookies && req.cookies[DEVICE_COOKIE];
  const deviceId = isValidDeviceId(existing) ? existing : crypto.randomUUID();
  if (deviceId !== existing) {
    res.cookie(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      maxAge: DEVICE_COOKIE_MAX_AGE
    });
  }
  return deviceId;
}

function rememberedDeviceName(req) {
  const value = req.cookies && req.cookies[DEVICE_NAME_COOKIE];
  return typeof value === 'string' ? value.slice(0, 80) : '';
}

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
  getOrCreateDeviceId(req, res);
  res.render('login', { error: null, identifier: rememberedDeviceName(req) });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username, password, identifier } = req.body;
  const clientIp = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace(/^\[|\]$/g, '').split(',')[0].trim() || '127.0.0.1';
  const deviceName = (identifier || '').trim().slice(0, 80);

  if (username === validUser && verifyPassword(password, validPassHash)) {
    const deviceId = getOrCreateDeviceId(req, res);
    return req.session.regenerate((err) => {
      if (err) {
        tools.logError('Error regenerating session on login: ' + err.message, clientIp);
        return res.status(500).render('login', { error: 'Login failed, please try again.', identifier: deviceName });
      }
      req.session.authenticated = true;
      req.session.loginMeta = {
        ip: clientIp,
        userAgent: (req.get('User-Agent') || 'unknown').slice(0, 250),
        loginTime: new Date().toISOString(),
        identifier: deviceName || undefined,
        deviceId
      };
      if (deviceName) {
        res.cookie(DEVICE_NAME_COOKIE, deviceName, {
          httpOnly: true,
          sameSite: 'lax',
          secure: cookieSecure,
          maxAge: DEVICE_COOKIE_MAX_AGE
        });
      }
      tools.logData(`Successful login for username "${String(username || '').trim() || 'unknown'}" from IP ${clientIp} (device ${deviceId.slice(0, 8)})`, 'INFO', clientIp);
      return res.redirect('/');
    });
  }
  tools.logError(`Failed login attempt for username "${String(username || '').trim() || 'unknown'}" from IP ${clientIp}`, clientIp);
  res.render('login', { error: 'Invalid username or password', identifier: deviceName || rememberedDeviceName(req) });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
