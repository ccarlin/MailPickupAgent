const express = require('express');
const router = express.Router();
const notifications = require('../notifications');
const tools = require('../tools');

router.get('/public-key', (req, res) => {
  res.json({ publicKey: notifications.publicKey });
});

router.post('/subscribe', (req, res) => {
  const { subscription, emailFilter } = req.body;
  if (!subscription) {
    return res.status(400).json({ error: 'Subscription is required' });
  }
  try {
    notifications.subscribe(subscription, emailFilter || null);
    res.status(201).json({ success: true });
  } catch (err) {
    tools.logError(`Subscription error: ${err.message}`);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required' });
  }
  try {
    notifications.unsubscribe(endpoint);
    res.json({ success: true });
  } catch (err) {
    tools.logError(`Unsubscription error: ${err.message}`);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

module.exports = router;
