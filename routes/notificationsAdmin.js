const express = require('express');
const router = express.Router();
const notifications = require('../app/notifications');
const tools = require('../app/tools');

router.get('/', function(req, res) {
  try {
    const subscriptions = notifications.getAll();
    res.render('notificationsAdmin', { title: 'Notification Subscriptions', subscriptions });
  } catch (err) {
    tools.logError(`Error fetching subscriptions: ${err.message}`);
    res.render('notificationsAdmin', { title: 'Notification Subscriptions', subscriptions: [] });
  }
});

router.get('/count', function(req, res) {
  try {
    const subscriptions = notifications.getAll();
    res.json({ count: subscriptions.length });
  } catch (err) {
    tools.logError(`Error get notification count: ${err}`);
    res.json({ count: 0 });
  }
});

router.post('/:id/delete', function(req, res) {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Invalid ID' });
  }
  try {
    notifications.deleteById(id);
    tools.logData(`Notification subscription ${id} deleted by admin`, 'INFO', req.ip || req.socket.remoteAddress || '127.0.0.1');
    res.redirect('/notificationsAdmin');
  } catch (err) {
    tools.logError(`Error deleting subscription ${id}: ${err.message}`, req.ip || req.socket.remoteAddress || '127.0.0.1');
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

module.exports = router;
