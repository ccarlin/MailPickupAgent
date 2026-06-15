const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const session = require('express-session');
const SQLiteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const app = express();
const { buildAllTestEmails, processEmail, wipeall } = require('./index.js');
const tools = require('./tools');
const appConfig = require('./config');
const { verifyPassword } = require('./middleware/hash');

const PORT = appConfig.PORT || 6245;

// View engine setup
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

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

const sessionStore = new SQLiteStore({
  client: new Database('./config/sessions.sqlite'),
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
app.use('/configEditor', require('./routes/configEditor'));
app.use('/mailq', require('./routes/mailqRoute'));
app.use('/generateLink', require('./routes/generateLink'));
app.use('/MailLog', require('./routes/MailLog.js'));
app.use('/SMTPLog', require('./routes/SMTPLog'));
app.use('/QuarantineLog', require('./routes/QuarantineLog'));
app.use('/emailPreview', require('./routes/emailPreview'));
app.use('/deleted', require('./routes/deletedRoute'));
app.use('/status', require('./routes/status'));

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
    version: '1.0.0',
    endpoints: {
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
      }
    }
  });
});

// GET Route - Get current configuration
app.get('/api/config', (req, res) => {
  res.status(200).json({
    rules: config.rules,
    settings: config.settings
  });
});

// GET Route - Send test emails
app.get('/api/test-emails', async (req, res) => {
  try {
    const recipient = req.query.recipient || appConfig.TEST_EMAIL_RECIPIENT || 'chuck@ccarlin.com';
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

    // Process synchronously
    await processEmail(controlFilePath, messagePath, config.rules);
    
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
    res.status(500).json({ error: error.message });
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
  tools.logData(`  GET  /api/help`);
  tools.logData(`  GET  /api/config`);
  tools.logData(`  GET  /api/test-emails`);
  tools.logData(`  POST /api/process`);
}

if (appConfig.CERT_PATH && appConfig.CERT_KEY_PATH) {
  try {
    const privateKey = fs.readFileSync(appConfig.CERT_KEY_PATH, 'utf8');
    const certificate = fs.readFileSync(appConfig.CERT_PATH, 'utf8');
    const credentials = { key: privateKey, cert: certificate };
    https.createServer(credentials, app).listen(PORT, () => {
      startServer('https');
    });
  } catch (err) {
    tools.logError(`Failed to load SSL certificates: ${err.message}`);
    tools.logData('Falling back to HTTP.');
    app.listen(PORT, () => {
      startServer('http');
    });
  }
} else {
  app.listen(PORT, () => {
    startServer('http');
  });
}
