const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const tools = require('./tools');

const keysFile = path.join(__dirname, 'config', '.vapid-keys.json');
let vapidKeys;

if (fs.existsSync(keysFile)) {
  try {
    vapidKeys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  } catch (err) {
    tools.logError(`Error reading VAPID keys: ${err.message}`);
  }
}

if (!vapidKeys) {
  vapidKeys = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(keysFile, JSON.stringify(vapidKeys), 'utf8');
  } catch (err) {
    tools.logError(`Error saving VAPID keys: ${err.message}`);
  }
}

webpush.setVapidDetails(
  'mailto:admin@localhost', // Fallback, should probably be configurable
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const dbPath = path.join(__dirname, 'config', 'sessions.sqlite');
const db = new Database(dbPath);

// Initialize the notifications table
db.prepare(`
  CREATE TABLE IF NOT EXISTS notification_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription TEXT NOT NULL,
    email_filter TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// Migration: add ip_address column if it doesn't exist (for databases created before this column was added)
try {
  db.prepare('ALTER TABLE notification_subscriptions ADD COLUMN ip_address TEXT').run();
} catch {
  // Column already exists — ignore
}

module.exports = {
  publicKey: vapidKeys.publicKey,

  getAll: () => {
    return db.prepare('SELECT * FROM notification_subscriptions ORDER BY created_at DESC').all();
  },

  deleteById: (id) => {
    const stmt = db.prepare('DELETE FROM notification_subscriptions WHERE id = ?');
    return stmt.run(id);
  },

  subscribe: (subscription, emailFilter, ipAddress) => {
    const stmt = db.prepare('INSERT INTO notification_subscriptions (subscription, email_filter, ip_address) VALUES (?, ?, ?)');
    return stmt.run(JSON.stringify(subscription), emailFilter, ipAddress || null);
  },

  checkSubscription: (endpoint) => {
    const row = db.prepare('SELECT COUNT(*) AS count FROM notification_subscriptions WHERE subscription LIKE ?').get(`%${endpoint}%`);
    return row.count > 0;
  },

  unsubscribe: (endpoint) => {
    const stmt = db.prepare('DELETE FROM notification_subscriptions WHERE subscription LIKE ?');
    return stmt.run(`%${endpoint}%`);
  },

  getSubscriptionsForRecipients: (recipientEmails) => {
    if (!recipientEmails || recipientEmails.length === 0) {
      return db.prepare('SELECT * FROM notification_subscriptions WHERE email_filter IS NULL').all();
    }
    const placeholders = recipientEmails.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM notification_subscriptions WHERE email_filter IS NULL OR email_filter IN (${placeholders})`);
    return stmt.all(...recipientEmails);
  },

  sendNotification: async (subscription, payload) => {
    try {
      await webpush.sendNotification(JSON.parse(subscription), JSON.stringify(payload));
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Subscription has expired or is no longer valid
        module.exports.unsubscribe(JSON.parse(subscription).endpoint);
      } else {
        tools.logError(`Error sending push notification: ${err.message}`);
      }
    }
  },

  notifyQuarantine: async (emailInfo) => {
    const recipients = (emailInfo.recipientAddresses || []).map(r => r.toLowerCase());

    // Find all subscriptions that either have no filter or match one of the recipient emails
    const relevantSubscriptions = module.exports.getSubscriptionsForRecipients(recipients);

    const notificationPromises = relevantSubscriptions.map(sub => {
      return module.exports.sendNotification(sub.subscription, {
        title: 'Email Quarantined',
        body: `From: ${emailInfo.from}\nSubject: ${emailInfo.subject}`,
        url: `/mailq?user=${sub.email_filter || 'all'}`
      });
    });

    await Promise.allSettled(notificationPromises);
  }
};
