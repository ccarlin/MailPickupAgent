# Mail Pickup Agent - REST API Documentation

## Overview

The Mail Pickup Agent now includes a REST API server that loads configuration once at startup and provides endpoints for email processing, testing, and configuration management.

## Starting the Server

```bash
npm run server
# or
node server.js
```

The server will start on port 3000 by default. You can change this with the `PORT` environment variable:

```bash
PORT=8080 npm run server
```

## Configuration Loading

All configuration is loaded **once at server startup** from the `rules.json` file. This eliminates the need to reload configuration for each request.

The loaded configuration includes:
- Whitelist rules (senders, IP ranges)
- Blacklist rules (senders, subjects, IP ranges, countries)
- Keyword filters and scoring
- TLD restrictions
- Combo rules (sender + subject + recipient combinations)

## API Endpoints

### 1. GET /api/help

Display help information and available endpoints.

**Request:**
```bash
curl http://localhost:3000/api/help
```

**Response:**
```json
{
  "message": "Mail Pickup Agent API",
  "version": "1.0.0",
  "endpoints": {
    "help": {
      "method": "GET",
      "path": "/api/help",
      "description": "Show this help message"
    },
    ...
  }
}
```

---

### 2. GET /api/config

Retrieve the currently loaded configuration and settings.

**Request:**
```bash
curl http://localhost:3000/api/config
```

**Response:**
```json
{
  "rules": {
    "whitelist": {
      "senders": [".usaa.com", "@gmail.com", ...],
      "ipRanges": [...]
    },
    "blacklist": {
      "senders": [...],
      "subjects": [...],
      "ipRanges": [...],
      "countries": [...],
      "keywordFilters": [...]
    },
    "allowedTLDs": [...]
  },
  "settings": {
    "quarantineDir": "./quarantine",
    "deletedDir": "./deleted",
    "smtpHost": "localhost",
    "smtpPort": 25,
    "spamAssassinEnabled": false,
    "aiCheckEnabled": false,
    "dryRunEnabled": false
  }
}
```

---

### 3. GET /api/test-emails

Send all test emails to verify the configuration. This is useful for testing email delivery and rule matching.

**Query Parameters:**
- `recipient` (optional): Email address to send test emails to (defaults to `TEST_EMAIL_RECIPIENT` environment variable or 'chuck@ccarlin.com')

**Request:**
```bash
curl "http://localhost:3000/api/test-emails?recipient=test@example.com"
```

**Response:**
```json
{
  "message": "Test email process started",
  "testCount": 6,
  "details": [
    {
      "name": "blacklist-sender",
      "from": "bad@spam.test",
      "subject": "Test blacklist sender"
    },
    {
      "name": "whitelist-sender",
      "from": "noreply@amazon.com",
      "subject": "Test whitelist sender"
    },
    ...
  ]
}
```

**Note:** Test emails are sent asynchronously. The response returns immediately while emails are being sent in the background.

---

### 4. POST /api/dry-run

Perform a dry run of email processing without actually quarantining or deleting emails. This allows you to test rule matching and file paths.

**Request Body:**
```json
{
  "controlFilePath": "/path/to/control/file.H00",
  "messagePath": "/path/to/message/file.MAI",
  "simulate": false
}
```

**Parameters:**
- `controlFilePath` (required): Full path to the MailEnable control file (.H00)
- `messagePath` (required): Full path to the MailEnable message file (.MAI)
- `simulate` (optional): If true, performs a simulation without copying files (default: false)

**Request:**
```bash
curl -X POST http://localhost:3000/api/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\control.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\message.MAI",
    "simulate": false
  }'
```

**Response:**
```json
{
  "message": "Dry run completed successfully",
  "simulate": false,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\control.H00",
  "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\message.MAI",
  "dryRunDir": "./dry-run-output",
  "filesProcessed": [
    "./dry-run-output/message.H00",
    "./dry-run-output/message.MAI"
  ]
}
```

**Error Response (400):**
```json
{
  "error": "Missing required parameters",
  "required": ["controlFilePath", "messagePath"]
}
```

**Error Response (404):**
```json
{
  "error": "Control file not found",
  "path": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\control.H00"
}
```

---

### 5. POST /api/process

Process an email with the configured rules. This applies all whitelist, blacklist, keyword, and spam checking rules, then quarantines or deletes the email accordingly.

**Request Body:**
```json
{
  "controlFilePath": "/path/to/control/file.H00",
  "messagePath": "/path/to/message/file.MAI"
}
```

**Parameters:**
- `controlFilePath` (required): Full path to the MailEnable control file (.H00)
- `messagePath` (required): Full path to the MailEnable message file (.MAI)

**Request:**
```bash
curl -X POST http://localhost:3000/api/process \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\control.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\message.MAI"
  }'
```

**Response (202 Accepted):**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\control.H00",
  "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\message.MAI",
  "status": "queued",
  "message": "Email processing has been queued"
}
```

**Note:** Processing is done asynchronously in the background. The endpoint returns HTTP 202 (Accepted) immediately while processing continues. Check server logs for processing results.

**Error Response (400):**
```json
{
  "error": "Missing required parameters",
  "required": ["controlFilePath", "messagePath"]
}
```

**Error Response (404):**
```json
{
  "error": "Message file not found",
  "path": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\message.MAI"
}
```

---

## Environment Variables

Configure the behavior of the server using environment variables:

### File Paths
- `RULES_FILE`: Path to rules.json (default: './config/rules.json')
- `QUARANTINE_DIR`: Directory for quarantined emails (default: './quarantine')
- `DELETED_DIR`: Directory for deleted emails (default: './deleted')
- `DRY_RUN_COPY_DEST`: Directory for dry-run output (default: './dry-run-output')

### SMTP Configuration
- `SMTP_HOST`: SMTP server hostname (default: 'localhost')
- `SMTP_PORT`: SMTP server port (default: 25)
- `TEST_EMAIL_RECIPIENT`: Default recipient for test emails (default: 'chuck@ccarlin.com')
- `TEST_EMAIL_FROM`: Default sender for test emails (default: '"MailPickupAgent" <no-reply@localhost>')

### Feature Flags
- `SPAMASSASSIN_ENABLED`: Enable SpamAssassin checks (default: 'false')
- `SPAMASSASSIN_HOST`: SpamAssassin server hostname (default: 'localhost')
- `SPAMASSASSIN_PORT`: SpamAssassin server port (default: 783)
- `AI_CHECK_ENABLED`: Enable Ollama AI spam checking (default: 'false')
- `OLLAMA_SERVER`: Ollama server hostname (default: 'localhost')
- `OLLAMA_PORT`: Ollama server port (default: 11434)
- `OLLAMA_MODEL`: Ollama model name (default: 'llama3.2')
- `DRY_RUN_COPY_LOG`: Enable dry-run file logging (default: 'false')
- `DRY_RUN_LOG_FILE`: Path to dry-run log file (default: './mailpickupagent-dryrun.log')

### Server
- `PORT`: Web server port (default: 3000)

### Example .env file:
```
PORT=3000
SMTP_HOST=mail.example.com
SMTP_PORT=25
TEST_EMAIL_RECIPIENT=admin@example.com
QUARANTINE_DIR=./quarantine
DELETED_DIR=./deleted
SPAMASSASSIN_ENABLED=true
SPAMASSASSIN_HOST=localhost
SPAMASSASSIN_PORT=783
```

---

## Usage Examples

### Test Configuration
```bash
# Check if server is running and see all endpoints
curl http://localhost:3000/api/help

# View currently loaded configuration
curl http://localhost:3000/api/config
```

### Send Test Emails
```bash
# Send test emails to default recipient
curl http://localhost:3000/api/test-emails

# Send test emails to specific recipient
curl "http://localhost:3000/api/test-emails?recipient=myemail@example.com"
```

### Dry Run Processing
```bash
# Test without copying files (simulation mode)
curl -X POST http://localhost:3000/api/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\ABC123.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\ABC123.MAI",
    "simulate": true
  }'

# Test with actual file copying
curl -X POST http://localhost:3000/api/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\ABC123.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\ABC123.MAI",
    "simulate": false
  }'
```

### Process Email
```bash
curl -X POST http://localhost:3000/api/process \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\ABC123.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\ABC123.MAI"
  }'
```

---

## CLI Mode (Still Supported)

The original CLI functionality is still available:

```bash
# Process a single email from command line
node index.js "ABC123.MAI" "SMTP"

# Send test emails from command line
node index.js --test quarantine
node index.js --test good
node index.js --test blacklist
```

---

## Performance Notes

- **Configuration Loading**: All configuration is loaded once at server startup, improving performance for multiple requests
- **Async Processing**: Email processing and test email sending are performed asynchronously to avoid blocking API responses
- **File Operations**: All file operations (quarantine, delete, dry-run) are synchronous but happen asynchronously relative to the HTTP response

---

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200 OK`: Successful GET request
- `202 Accepted`: Asynchronous processing started (POST endpoints)
- `400 Bad Request`: Missing or invalid parameters
- `404 Not Found`: Required files not found
- `500 Internal Server Error`: Unexpected server error

All error responses include a `message` or `error` field describing the issue.
