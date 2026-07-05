const express = require('express');
const router = express.Router();
const notifications = require('../notifications');
const tools = require('../tools');

router.get('/public-key', (req, res) => {
  res.json({ publicKey: notifications.publicKey });
});

router.get('/check', (req, res) => {
  const { endpoint } = req.query;
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required' });
  }
  try {
    const registered = notifications.checkSubscription(endpoint);
    res.json({ registered });
  } catch (err) {
    tools.logError(`Check subscription error: ${err.message}`);
    res.status(500).json({ error: 'Failed to check subscription' });
  }
});

router.post('/subscribe', (req, res) => {
  const { subscription, emailFilter } = req.body;
  if (!subscription) {
    return res.status(400).json({ error: 'Subscription is required' });
  }
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    notifications.subscribe(subscription, emailFilter || null, ip);
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
