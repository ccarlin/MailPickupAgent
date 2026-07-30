const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const session = require('express-session');
const SQLiteStore = require('better-sqlite3-session-store')(session);
const cookieParser = require('cookie-parser');
const app = express();
const { buildAllTestEmails, processEmail, wipeall, loadRules } = require('./index.js');
const tools = require('./app/tools');
const appConfig = require('./config');
const { verifyPassword } = require('./middleware/hash');
const { version } = require('./package.json');
const PORT = appConfig.PORT || 6245;
let server;

// View engine setup
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.locals.version = version;

// Middleware to parse incoming request bodies
app.use(express.static(__dirname + '/public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser — required for req.cookies support
app.use(cookieParser());

// Session middleware — auto-generate secret if left as default
let sessionSecret = appConfig.AUTH_SECRET;
if (!sessionSecret || sessionSecret === 'change-this-to-a-random-secret-in-production') {
  const secretFile = path.join(__dirname, 'config', '.session-secret');
  try {
    if (fs.existsSync(secretFile)) {
      sessionSecret = fs.readFileSync(secretFile, 'utf8');
    } else {
      sessionSecret = require('crypto').randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, sessionSecret, 'utf8');
    }
  } catch (err) {
    tools.logError(`Error handling session secret: ${err.message}`);
    sessionSecret = 'fallback-secret-for-session';
  }
}

const db = require('./app/db');
const sessionStore = new SQLiteStore({
  client: db,
  expired: {
    clear: true,
    intervalMs: 900000 // 15 minutes
  }
});

app.use(session({
  store: sessionStore,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: !!(appConfig.CERT_PATH && appConfig.CERT_KEY_PATH),
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

// Make env info available to all views
app.use((req, res, next) => {
  res.locals.envLabel = appConfig.NODE_ENV || 'production';
  res.locals.envClass = appConfig.NODE_ENV || 'production';
  next();
});

// Lightweight health check for load balancers and process monitors (no auth)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    version,
    uptime: Math.floor(process.uptime()),
  });
});

// Auth routes (unprotected)
app.use('/', require('./routes/auth'));

// Auth middleware - protects all subsequent routes
const authMiddleware = require('./middleware/auth');
app.use(authMiddleware);

// Default landing page
app.get('/', (req, res) => {
  res.redirect('/status');
});

app.use('/rulesEditor', require('./routes/rulesEditor'));
app.use('/ruleHits', require('./routes/ruleHitsReport'));
app.use('/configEditor', require('./routes/configEditor'));
app.use('/mailq', require('./routes/mailqRoute'));
app.use('/generateLink', require('./routes/generateLink'));
app.use('/MailLog', require('./routes/MailLog.js'));
app.use('/SMTPLog', require('./routes/SMTPLog'));
app.use('/QuarantineLog', require('./routes/QuarantineLog'));
app.use('/emailPreview', require('./routes/emailPreview'));
app.use('/deleted', require('./routes/deletedRoute'));
app.use('/status', require('./routes/status'));
app.use('/sessions', require('./routes/sessions'));
app.use('/notifications', require('./routes/notifications'));
app.use('/notificationsAdmin', require('./routes/notificationsAdmin'));
app.use('/configHistory', require('./routes/configHistory'));

// Configuration loaded at startup
let config = {
  rules: null,
  settings: {}
};

// Load configuration at startup
function initializeConfiguration() {
  try {
    const rulesData = fs.readFileSync('./config/rules.json', 'utf8');
    config.rules = JSON.parse(rulesData);
    tools.logData('Configuration loaded successfully');
  } catch (error) {
    config.rules = { whitelist: {}, blacklist: {} };
    if (error.code === 'ENOENT') {
      try {
        fs.writeFileSync('./config/rules.json', JSON.stringify(config.rules, null, 2), 'utf8');
        tools.logData('Created new blank rules.json');
        tools.logData('Open http://localhost:' + PORT + '/rulesEditor to configure your rules.');
        tools.logData('See config/rules.json.sample for the full rules structure and examples.');
      } catch (writeError) {
        tools.logError(`Error creating rules.json: ${writeError.message}`);
      }
    }
  }
  
  config.settings = {
    quarantineDir: appConfig.QUARANTINE_DIR,
    deletedDir: appConfig.DELETED_DIR,
    smtpHost: appConfig.SMTP_HOST,
    smtpPort: appConfig.SMTP_PORT,
    spamAssassinEnabled: appConfig.SPAMASSASSIN_ENABLED,
    aiCheckEnabled: appConfig.AI_CHECK_ENABLED
  };

  // Ensure required directories exist
  [appConfig.QUARANTINE_DIR, appConfig.DELETED_DIR, appConfig.PROCESSING_LOG, appConfig.QUARANTINE_LOG].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      tools.logData(`Created directory: ${dir}`);
    }
  });
}

// GET Route - Help/Info
app.get('/api/help', (req, res) => {
  res.status(200).json({
    message: 'Mail Pickup Agent API',
    version,
    endpoints: {
      health: {
        method: 'GET',
        path: '/health',
        description: 'Lightweight health check (no authentication required)'
      },
      help: {
        method: 'GET',
        path: '/api/help',
        description: 'Show this help message'
      },
      config: {
        method: 'GET',
        path: '/api/config',
        description: 'Get current configuration and settings'
      },
      testEmails: {
        method: 'GET',
        path: '/api/test-emails',
        description: 'Send all test emails to verify configuration',
        queryParams: {
          recipient: 'Email recipient (optional, defaults to TEST_EMAIL_RECIPIENT config value)'
        }
      },      
      processEmail: {
        method: 'POST',
        path: '/api/process',
        description: 'Process an email with the configured rules',
        bodyParams: {
          messageID: 'Message ID/filename (required)',
          queueType: 'Queue type like SMTP (required)'
        }
      },
      wipeall: {
        method: 'POST',
        path: '/api/wipeall',
        description: 'Delete all log files and all emails in the queue and deleted folders'
      },
      spamReason: {
        method: 'GET',
        path: '/api/spam-reason/:type/:id',
        description: 'Get spam reason for an email from quarantine or deleted directory',
        pathParams: {
          type: 'Directory type: "quarantine" or "deleted"',
          id: 'Email ID'
        }
      },
      emailLookup: {
        method: 'GET',
        path: '/api/email-lookup/:id',
        description: 'Look up email info by ID, trying quarantine then deleted directories',
        pathParams: {
          id: 'Email ID'
        }
      }
    }
  });
});

// GET Route - Get current configuration
app.get('/api/config', (req, res) => {
  res.status(200).json({
    rules: loadRules(),
    settings: config.settings
  });
});

// GET Route - Send test emails
app.get('/api/test-emails', async (req, res) => {
  try {
    const recipient = req.query.recipient || appConfig.TEST_EMAIL_RECIPIENT || 'test@example.com';
    const tests = buildAllTestEmails();
    const testResults = [];
    
    res.status(200).json({
      message: 'Test email process started',
      testCount: tests.length,
      details: tests.map(t => ({
        name: t.name,
        from: t.mail.from,
        subject: t.mail.subject
      }))
    });

    // Send emails asynchronously without blocking response
    (async () => {
      for (let index = 0; index < tests.length; index++) {
        const t = tests[index];
        try {
          // Would send via transporter here
          tools.logData(`Test email: ${t.name} would be sent to ${recipient}`);
          testResults.push({ name: t.name, status: 'sent' });
        } catch (err) {
          tools.logError(`Failed to send test '${t.name}': ${err.message}`);
          testResults.push({ name: t.name, status: 'failed', error: err.message });
        }
      }
      tools.logData(`All test emails processed: ${JSON.stringify(testResults)}`, "INFO");
    })();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST Route - Process email
app.post('/api/process', async (req, res) => {
  try {
    const { messageID, queueType } = req.body;
    
    if (!messageID || !queueType) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['messageID', 'queueType']
      });
    }

    const { messagePath, controlFilePath } = tools.buildFilePaths(messageID, queueType);

    // Verify files exist
    if (!fs.existsSync(controlFilePath)) {
      return res.status(404).json({ error: 'Control file not found', path: controlFilePath });
    }
    if (!fs.existsSync(messagePath)) {
      return res.status(404).json({ error: 'Message file not found', path: messagePath });
    }

    // Process synchronously — load fresh rules each time so editor saves take effect immediately
    await processEmail(controlFilePath, messagePath, loadRules());
    
    const result = {
      timestamp: new Date().toISOString(),
      messageID,
      queueType,
      messagePath,
      controlFilePath,
      status: 'completed',
      message: 'Email processing completed successfully'
    };

    res.status(200).json(result);
  } catch (error) {
    const status = /^Invalid (messageID|queueType)/.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
});

// GET Route - Get spam reason for an email from quarantine or deleted directory
app.get('/api/spam-reason/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        let emailPath;
        if (type === 'quarantine') {
            emailPath = appConfig.QUARANTINE_DIR;
        } else if (type === 'deleted') {
            emailPath = appConfig.DELETED_DIR;
        } else {
            return res.status(400).json({ error: 'Invalid type. Use "quarantine" or "deleted".' });
        }
        const reason = await tools.getSpamReason(id, emailPath);
        res.json({ emailId: id, type, reason });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET Route - Look up email info by ID, trying quarantine then deleted directories
app.get('/api/email-lookup/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let found = false;
        let type = null;
        let reason = null;

        reason = await tools.getSpamReason(id, appConfig.QUARANTINE_DIR);
        if (reason !== null) {
            found = true;
            type = 'quarantine';
        } else {
            reason = await tools.getSpamReason(id, appConfig.DELETED_DIR);
            if (reason !== null) {
                found = true;
                type = 'deleted';
            }
        }

        res.json({ emailId: id, found, type, reason });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST Route - Wipe all log files and emails in queue and deleted folders
app.post('/api/wipeall', (req, res) => {
  try {
    const count = wipeall();
    res.status(200).json({
      success: true,
      message: `WipeAll complete: ${count} file(s) removed`,
      filesRemoved: count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize configuration on startup
initializeConfiguration();

// Validate security: certificate requires non-default password
if (appConfig.CERT_PATH) {
  const pwHash = appConfig.AUTH_PASSWORD_HASH;
  if (!pwHash || verifyPassword('admin', pwHash)) {
    tools.logError('SECURITY ERROR: Certificate is configured but the admin password is still the default.');
    tools.logError('Change it via the Configuration Editor (Security section > Admin Password field).');
    process.exit(1);
  }
}


// Start the server
function startServer(protocol) {
  tools.logData(`Server is running on ${protocol}://localhost:${PORT}`);
  tools.logData(`Configuration loaded at startup`);
  tools.logData(`Open ${protocol}://localhost:${PORT}/ to access the admin interface.`);
  if (appConfig.CERT_PATH) {
    tools.logData(`Authentication is enabled. Log in with the configured credentials.`);
  } else {
    tools.logData(`Authentication is disabled for local connections.`);
  }
  tools.logData(`API endpoints available:`);
  tools.logData(`  GET  /health`);
  tools.logData(`  GET  /api/help`);
  tools.logData(`  GET  /api/config`);
  tools.logData(`  GET  /api/test-emails`);
  tools.logData(`  POST /api/process`);
  tools.logData(`  GET  /api/spam-reason/:type/:id`);
  tools.logData(`  GET  /api/email-lookup/:id`);
  tools.logData(`  POST /api/wipeall`);
}

if (appConfig.CERT_PATH && appConfig.CERT_KEY_PATH) {
  try {
    const privateKey = fs.readFileSync(appConfig.CERT_KEY_PATH, 'utf8');
    const certificate = fs.readFileSync(appConfig.CERT_PATH, 'utf8');
    const credentials = { key: privateKey, cert: certificate };
    server = https.createServer(credentials, app).listen(PORT, () => {
      startServer('https');
    });
  } catch (err) {
    tools.logError(`Failed to load SSL certificates: ${err.message}`);
    tools.logData('Falling back to HTTP.');
    server = app.listen(PORT, () => {
      startServer('http');
    });
  }
} else {
  server = app.listen(PORT, () => {
    startServer('http');
  });
}

// Global uncaught exception and rejection handlers
process.on('uncaughtException', (err) => {
  tools.logError(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  tools.logError(`UNHANDLED REJECTION: ${reason instanceof Error ? reason.message : reason}\n${reason instanceof Error ? reason.stack : ''}`);
});

// Graceful shutdown — shared by SIGINT and SIGTERM
function gracefulShutdown(signal) {
  tools.logData(`${signal} signal received: closing HTTP server`);

  server.close(() => {
    tools.logData('HTTP server closed');

    // Close the shared SQLite database connection
    try {
      if (db && typeof db.close === 'function') {
        db.close();
        tools.logData('Closed database connection');
      }
    } catch (err) {
      tools.logError(`Error closing database: ${err.message}`);
    }

    process.exit(0);
  });

  // Force close after 10 seconds if it's taking too long
  setTimeout(() => {
    tools.logError('Forcing shutdown...');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
