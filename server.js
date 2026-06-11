const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const { buildAllTestEmails, processEmail } = require('./index.js');
const tools = require('./tools');
const appConfig = require('./config');

const PORT = appConfig.PORT || 6245;

// View engine setup
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse incoming request bodies
app.use(express.static(__dirname + '/public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make env info available to all views
app.use((req, res, next) => {
  res.locals.envLabel = appConfig.NODE_ENV || 'development';
  res.locals.envClass = appConfig.NODE_ENV || 'development';
  next();
});

// Default landing page
app.get('/', (req, res) => {
  res.render('default');
});

app.use('/rulesEditor', require('./routes/rulesEditor'));
app.use('/configEditor', require('./routes/configEditor'));
app.use('/mailq', require('./routes/mailQRoute'));
app.use('/MailLog', require('./routes/MailLog.js'));
app.use('/SMTPLog', require('./routes/SMTPLog'));
app.use('/QuarantineLog', require('./routes/QuarantineLog'));
app.use('/emailPreview', require('./routes/emailPreview'));
app.use('/deleted', require('./routes/deletedRoute'));

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
    tools.logError(`Error loading configuration: ${error.message}`);
    config.rules = { whitelist: {}, blacklist: {} };
  }
  
  config.settings = {
    quarantineDir: appConfig.QUARANTINE_DIR,
    deletedDir: appConfig.DELETED_DIR,
    smtpHost: appConfig.SMTP_HOST,
    smtpPort: appConfig.SMTP_PORT,
    spamAssassinEnabled: appConfig.SPAMASSASSIN_ENABLED,
    aiCheckEnabled: appConfig.AI_CHECK_ENABLED
  };
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

// Initialize configuration on startup
initializeConfiguration();

// Start the server
app.listen(PORT, () => {
    tools.logData(`Server is running on http://localhost:${PORT}`);
    tools.logData(`Configuration loaded at startup`);
    tools.logData(`API endpoints available:`);
    tools.logData(`  GET  /api/help`);
    tools.logData(`  GET  /api/config`);
    tools.logData(`  GET  /api/test-emails`);
    tools.logData(`  POST /api/process`);
});
