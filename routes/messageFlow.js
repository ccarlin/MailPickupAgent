const express = require('express');
const router = express.Router();

router.get('/', function (req, res) {
  res.render('messageFlow', { title: 'Message Flow' });
});

module.exports = router;
