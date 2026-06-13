const express = require('express');
const router = express.Router();
const appConfig = require('../config');
const { verifyPassword, hashPassword } = require('../middleware/hash');

function getPasswordHash() {
  if (appConfig.AUTH_PASSWORD_HASH) {
    return appConfig.AUTH_PASSWORD_HASH;
  }
  if (appConfig.AUTH_PASSWORD) {
    const hash = hashPassword(appConfig.AUTH_PASSWORD);
    console.warn('WARNING: AUTH_PASSWORD is stored in plaintext. Replace it with AUTH_PASSWORD_HASH in your config file.');
    console.warn(`  Generated hash: "${hash}"`);
    return hash;
  }
  return hashPassword('admin');
}

const validPassHash = getPasswordHash();
const validUser = appConfig.AUTH_USERNAME || 'admin';

router.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === validUser && verifyPassword(password, validPassHash)) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  res.render('login', { error: 'Invalid username or password' });
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
