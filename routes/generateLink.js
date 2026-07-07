const express = require('express');
const router = express.Router();
const tools = require('../app/tools');

router.get('/', function(req, res) {
  res.render('generateLink', { title: 'Generate Access Link', link: null });
});

router.post('/', function(req, res) {
  const email = req.body.email ? String(req.body.email).trim() : '';
  let link = null;
  let error = null;

  if (!email) {
    error = 'Please enter an email address.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    error = 'Please enter a valid email address.';
  } else {
    const localAddress = req.socket.localAddress || '127.0.0.1';
    const userPart = email.split('@')[0];
    const key = tools.generateKey(localAddress, null, 'mailq:' + userPart);
    const host = req.get('host');
    link = `${req.protocol}://${host}/mailq?Key=${key}&user=${encodeURIComponent(userPart)}`;
  }

  res.render('generateLink', { title: 'Generate Access Link', link, email, error });
});

module.exports = router;
