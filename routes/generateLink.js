const express = require('express');
const router = express.Router();
const tools = require('../app/tools');

router.get('/', function(req, res) {
  const keys = tools.getStoredKeys();
  res.render('generateLink', { title: 'Generate Access Link', link: null, keys });
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
    const userPart = email.split('@')[0];
    const key = tools.generateKey();
    const host = req.get('host');
    link = `${req.protocol}://${host}/mailq?Key=${key}`;
    tools.storeKey(key, email, userPart);
  }

  const keys = tools.getStoredKeys();
  res.render('generateLink', { title: 'Generate Access Link', link, email, error, keys });
});

router.post('/delete/:id', function(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!isNaN(id)) {
    tools.deleteStoredKey(id);
  }
  res.redirect('/generateLink');
});

module.exports = router;
