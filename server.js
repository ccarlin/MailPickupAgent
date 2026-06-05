const express = require('express');
const fs = require('fs');
const path = require('path');
const { buildAllTestEmails, processEmail } = require('./index.js');

const app = express();
const PORT = process.env.PORT || 3000;
const rulesEditRouter = require('./routes/rulesEditor');

// View engine setup
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse incoming JSON request bodies
app.use(express.json());
app.use('/rulesEditor', rulesEditRouter);

// GET route for the rules editor page
app.get('/rulesEditor', (req, res) => {
  res.render('rulesEditor');
});

// Helper function to build file paths from messageID and queueType
function buildFilePaths(messageID, queueType) {
  const qt = (queueType || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const envDir = (suffix) => `${qt}_${suffix}`;
  const messagePath = process.env[envDir('QUEUE_DIR')] ? path.join(process.env[envDir('QUEUE_DIR')], messageID) : messageID;
  const controlFilePath = process.env[envDir('COMMAND_DIR')] ? path.join(process.env[envDir('COMMAND_DIR')], messageID) : messageID;
  return { messagePath, controlFilePath };
}

// Configuration loaded at startup
let config = {
  rules: null,
  settings: {}
};

// Load configuration at startup
function initializeConfiguration() {
  try {
    const rulesFile = process.env.RULES_FILE || './config/rules.json';
    const rulesData = fs.readFileSync(rulesFile, 'utf8');
    config.rules = JSON.parse(rulesData);
    console.log('Configuration loaded successfully from', rulesFile);
  } catch (error) {
    console.error('Error loading configuration:', error.message);
    config.rules = { whitelist: {}, blacklist: {} };
  }
  
  // Store common settings
  config.settings = {
    quarantineDir: process.env.QUARANTINE_DIR || './quarantine',
    deletedDir: process.env.DELETED_DIR || './deleted',
    smtpHost: process.env.SMTP_HOST || 'localhost',
    smtpPort: process.env.SMTP_PORT || 25,
    spamAssassinEnabled: (process.env.SPAMASSASSIN_ENABLED || 'false').toLowerCase() === 'true',
    aiCheckEnabled: (process.env.AI_CHECK_ENABLED || 'false').toLowerCase() === 'true',
    dryRunEnabled: (process.env.DRY_RUN_COPY_LOG || 'false').toLowerCase() === 'true'
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
          recipient: 'Email recipient (optional, defaults to TEST_EMAIL_RECIPIENT env var)'
        }
      },
      dryRun: {
        method: 'POST',
        path: '/api/dry-run',
        description: 'Perform a dry run of email processing',
        bodyParams: {
          messageID: 'Message ID/filename (required)',
          queueType: 'Queue type like SMTP (required)',
          simulate: 'Boolean to simulate without actual file operations (optional)'
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
    const recipient = req.query.recipient || process.env.TEST_EMAIL_RECIPIENT || 'chuck@ccarlin.com';
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
          console.log(`Test email: ${t.name} would be sent to ${recipient}`);
          testResults.push({ name: t.name, status: 'sent' });
        } catch (err) {
          console.error(`Failed to send test '${t.name}':`, err.message);
          testResults.push({ name: t.name, status: 'failed', error: err.message });
        }
      }
      console.log('All test emails processed:', testResults);
    })();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST Route - Dry run email processing
app.post('/api/dry-run', async (req, res) => {
  try {
    const { messageID, queueType, simulate } = req.body;
    
    if (!messageID || !queueType) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['messageID', 'queueType']
      });
    }

    const { messagePath, controlFilePath } = buildFilePaths(messageID, queueType);
    const dryRunDir = process.env.DRY_RUN_COPY_DEST || './dry-run-output';
    
    // Verify files exist
    if (!fs.existsSync(controlFilePath)) {
      return res.status(404).json({ error: 'Control file not found', path: controlFilePath });
    }
    if (!fs.existsSync(messagePath)) {
      return res.status(404).json({ error: 'Message file not found', path: messagePath });
    }

    // Create dry-run directory if needed
    if (!fs.existsSync(dryRunDir)) {
      fs.mkdirSync(dryRunDir, { recursive: true });
    }

    const result = {
      timestamp: new Date().toISOString(),
      messageID,
      queueType,
      messagePath,
      controlFilePath,
      dryRunDir,
      filesProcessed: []
    };

    if (!simulate) {
      // Copy files to dry-run output directory
      const controlBasename = path.basename(controlFilePath);
      const messageBasename = path.basename(messagePath);
      const headerDest = path.join(dryRunDir, controlBasename).replace('.MAI', '.H00');
      const messageDest = path.join(dryRunDir, messageBasename);

      fs.copyFileSync(controlFilePath, headerDest);
      fs.copyFileSync(messagePath, messageDest);

      result.filesProcessed.push(headerDest, messageDest);
    }

    res.status(200).json({
      message: 'Dry run completed successfully',
      simulate: !!simulate,
      ...result
    });
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

    const { messagePath, controlFilePath } = buildFilePaths(messageID, queueType);

    // Verify files exist
    if (!fs.existsSync(controlFilePath)) {
      return res.status(404).json({ error: 'Control file not found', path: controlFilePath });
    }
    if (!fs.existsSync(messagePath)) {
      return res.status(404).json({ error: 'Message file not found', path: messagePath });
    }

    // Process synchronously
    await processEmail(controlFilePath, messagePath);
    
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
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Configuration loaded at startup`);
    console.log(`API endpoints available:`);
    console.log(`  GET  /api/help`);
    console.log(`  GET  /api/config`);
    console.log(`  GET  /api/test-emails`);
    console.log(`  POST /api/dry-run`);
    console.log(`  POST /api/process`);
});
