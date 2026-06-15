# Mail Pickup Agent for MailEnable

A Node.js email filtering agent that integrates with MailEnable's pickup event to intercept, scan, and route emails based on configurable rules.

## Features

- **MailEnable Pickup Integration** — invoked per-email via the pickup event
- **Admin Web Server** — UI for configuration, log viewing, quarantine/deleted email management
- **Multi-Layer Filtering** — whitelist/blacklist by sender, subject, IP, country, combo rules, and keyword filters
- **SpamAssassin Integration** — optional spamd scoring with configurable enable/disable
- **AI Classification** — Ollama-powered spam classification
- **Geolocation Filtering** — GeoIP country lookup for origin-based rules
- **Quarantine & Recovery** — suspicious emails held for review, deleted emails recoverable via web UI
- **Automatic Purge** — configurable retention-based cleanup of old deleted emails and log files

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)
- MailEnable (for production use)
- Read/Write access to the install folder or location of files and logs

### Setup

```bash
# Clone or download the project
cd mailpickupagent

# Install dependencies
npm install
```

## Configuration

All configuration is stored in JSON files under the `config/` directory. The system loads `config/default.json` as a base, then merges with `config/{NODE_ENV}.json` (where `NODE_ENV` defaults to `production`).

### Production vs Development

| File | Purpose |
|---|---|
| `config/default.json` | Base configuration with sensible defaults |
| `config/development.json` | Overrides for local testing (overlapping paths, test credentials) |
| `config/production.json` | Overrides for production MailEnable server |

The active environment is determined by the `NODE_ENV` environment variable. If not set, `production` is used.

### Editing Configuration

**Option 1: Web UI** — Start the server and navigate to `/configEditor`:

```bash
node server.js
```

**Option 2: Direct file edit** — Edit `config/default.json` or `config/{NODE_ENV}.json` directly.

### Key Settings

| Setting | Default | Description |
|---|---|---|
| `PORT` | `6245` | Web server port |
| `QUARANTINE_DIR` | `./mail/quarantine` | Directory for quarantined emails |
| `DELETED_DIR` | `./mail/deleted` | Directory for deleted emails |
| `SMTP_QUEUE_DIR` | *(MailEnable path)* | Inbound SMTP message queue |
| `SMTP_COMMAND_DIR` | *(MailEnable path)* | Inbound SMTP control files |
| `SMTP_LOG_DIR` | *(MailEnable path)* | MailEnable SMTP logs |
| `THRESHOLD_QUARANTINE` | `5` | Score at or above this value quarantines the email |
| `THRESHOLD_DELETE` | `15` | Score at or above this value deletes the email |
| `SPAMASSASSIN_ENABLED` | `false` | Enable SpamAssassin spam checks |
| `AI_CHECK_ENABLED` | `false` | Enable Ollama AI spam classification |
| `OLLAMA_SERVER` | `localhost` | Ollama server hostname |
| `OLLAMA_MODEL` | `llama3.2` | Ollama model name |
| `PURGE_EMAIL_AFTER_DAYS` | `30` | Retention for deleted emails (run `--purge`) |
| `PURGE_LOG_AFTER_DAYS` | `30` | Retention for log files |
| `PURGE_INCLUDE_SMTP_LOGS` | `false` | Also purge MailEnable SMTP log files |

## Usage

### Email Processing (Pickup Mode)

Process an email from the MailEnable pickup queue:

```bash
node index.js <messageID> <queueType>
```

Example:

```bash
node index.js "B935428C1B4A4B8FADC12BC6A4358875.MAI" "SMTP"
```

### Web Server (Admin UI)

Start the administration web interface:

```bash
node server.js
```

Then open `http://localhost:6245` in a browser. The web UI provides:

- **Configuration Editor** (`/configEditor`) — view and edit all settings
- **Quarantine Manager** (`/mailq`) — review, release, or delete quarantined emails
- **Deleted Email Viewer** (`/deleted`) — browse and recover deleted emails
- **Processing Log** (`/MailLog`) — view daily processing logs
- **Quarantine Log** (`/QuarantineLog`) — view quarantine action logs
- **SMTP Log Analyzer** (`/SMTPLog`) — analyze MailEnable SMTP logs
- **Rules Editor** (`/rulesEditor`) — manage whitelist, blacklist, and keyword filters
- **Status Page** (`/status` or `/`) — server dashboard showing total processed, pending counts, service status (SpamAssassin, AI), uptime, logged-in users, and auto-purge controls. This is the default landing page.

It is recommended that you use PM2 or a similar tool to ensure that the server is always running.  
Make sure to exlude logging directories and quarentine/deleted directories from any watch settings to avoid unnecessary restarts.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run email processing (pickup mode) |
| `npm run server` | Start the admin web server |
| `npm test` | Send test emails to verify configuration |
| `npm run purge` | Remove old deleted emails and log files |
| `npm run wipeall` | Delete all quarantined and deleted emails and ALL log files |
| `npm run spamTest` | Test Spamassassin to see if it is running and working |

### Test Emails

Send test emails to verify configuration:

```bash
npm test
```

Optional types: `good`, `quarantine`, `blacklist`:

```bash
npm test -- quarantine
```

### Test Spamassassin

Send test spam email to verify Spamassassin is installed and configured properly

```bash
npm run spamTest
```

### Purging Old Files

Remove deleted emails and log files older than the configured retention period:

```bash
npm run purge
```

Schedule this command to run daily via Windows Task Scheduler or cron.

### Wipe All Data

Delete all emails in the quarantine and deleted directories:

```bash
npm run wipeall
```

Use with caution — wiped emails cannot be recovered.

## Integration with MailEnable

MailEnable's Pickup Event fires for each incoming email, passing the message ID and queue type as arguments. There are two integration approaches:

### Option A: HTTP API (Requires Running Web Server)  (Recommended)

Requires the web server (`node server.js`) to be running continuously. Set MailEnable's pickup event to call `mailServerPickup.bat`:

```
C:\path\to\mailpickupagent\mailServerPickup.bat
```

This batch file sends a POST request to `http://localhost:6245/api/process` with the message ID and queue type. The web server must already be started (consider using PM2 to insure it is always running).

If you are using a port other than the default you must edit the batch file to match the port number the server is running on. 

### Option B: Direct Node.js Invocation

Set MailEnable's pickup event to call `run-mailpickup.bat`:

1. Open the **MailEnable Administration** program
2. Navigate to **Servers > localhost > Services > Pickup Event**
3. Set the **Command to execute** to:
   ```
   C:\path\to\mailpickupagent\run-mailpickup.bat
   ```

The `run-mailpickup.bat` script runs `node index.js` directly with the provided arguments.

### API Endpoints (when server is running)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/process` | Process an email (used by MailEnable pickup) |
| `GET` | `/api/config` | Get current configuration |
| `GET` | `/api/test-emails` | Trigger test email generation |
| `GET` | `/api/help` | API help and documentation |

## GeoIP Database

This project includes a `GeoLite2-Country.mmdb` file for IP-to-country lookups used by country-based filtering rules. The database may become outdated over time. For the most up-to-date IP geolocation data, download a free copy from MaxMind:

[https://www.maxmind.com/en/geolite-free-ip-geolocation-data](https://www.maxmind.com/en/geolite-free-ip-geolocation-data)

Replace the existing `GeoLite2-Country.mmdb` file in the project root with the downloaded version.

## Dependencies

- **axios** — HTTP client for Ollama API
- **collections** — Data structure utilities (maps, sets, heaps)
- **cookie-parser** — HTTP cookie parsing middleware
- **express** — Web server framework
- **express-session** — Session management middleware
- **mailparser** — Email parsing
- **mmdb-reader** — GeoIP country lookup
- **moment** — Date/time formatting and manipulation
- **spamassassin-client** — SpamAssassin SPAMC protocol client
- **nodemailer** — SMTP email sending
- **pug** — Template engine for admin UI
- **xss** — Input sanitization to prevent XSS attacks

## License

ISC
