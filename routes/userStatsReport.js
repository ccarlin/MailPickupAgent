const express = require('express');
const router = express.Router();
const userStats = require('../app/userStats');

router.get('/', function(req, res) {
  res.render('userStatsReport', { title: 'User Stats Report' });
});

router.get('/api/stats', function(req, res) {
  res.json(userStats.getStatsArray());
});

router.delete('/api/stats/clear', function(req, res) {
  const removed = userStats.clearAllStats();
  res.json({ success: true, removed });
});

router.delete('/api/stats/:user', function(req, res) {
  const user = decodeURIComponent(req.params.user);
  const removed = userStats.deleteUser(user);
  res.json({ success: removed > 0, removed });
});

module.exports = router;
