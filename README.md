# Mail Pickup Agent for MailEnable

A Node.js email filtering agent that integrates with MailEnable's pickup event to intercept, scan, and route emails based on configurable rules.

## Features

- **MailEnable Pickup Integration** — invoked per-email via the pickup event
- **Admin Web Server** — UI for configuration, log viewing, quarantine/deleted email management, session management, notification subscriptions, and config history
- **Multi-Layer Filtering** — whitelist/blacklist by sender, subject, IP, country, combo rules, keyword filters (regex/plain text), and allowed TLDs
- **Rule Hits Report** — track, view, and clear hit counts for whitelist, blacklist, country, combo, and keyword filter rules to see which rules are most active
- **SpamAssassin Integration** — optional spamd scoring with configurable enable/disable
- **AI Classification** — Ollama- or llama.cpp-powered spam classification with configurable backend, model, server, timeout, and scoring points
- **AbuseIPDB Integration** — optional IP reputation checking via AbuseIPDB API with configurable base/max scoring (runs automatically when API key is set)
- **AI Keyword Filter Generation** — generate keyword filter rules from a natural-language description via Ollama or llama.cpp
- **Geolocation Filtering** — GeoIP country lookup for origin-based rules (private IPs are skipped)
- **Quarantine & Recovery** — suspicious emails held for review, deleted emails recoverable via web UI
- **Automatic Purge** — configurable retention-based cleanup of old deleted emails, log files, SMTP logs, and configuration backups
- **Browser Push Notifications** — subscribe to real-time notifications when emails are quarantined (Web Push / Service Worker)
- **Configuration History** — automatic backups on save with a viewer/diff/restore interface and retention limits
- **Session Management** — view and terminate active admin sessions with login metadata (IP, user agent, identifier)
- **Status Dashboard** — live server metrics (processed, whitelisted, blacklisted, quarantined, released, pending queue), service health (SpamAssassin, AI, AbuseIPDB), uptime, logged-in users, notification count, and auto-purge toggle
- **Date Range Filtering** — filter log and deleted-mail pages by date range
- **Outbound Email Skipping** — emails submitted by internal MailEnable users are automatically skipped
- **X-MPA Headers** — emails are tagged with X-MPA-Scan, X-MPA-Msgid, X-MPA-SpamReason, X-MPA-SpamScore, X-MPA-SpamDetail, and X-MPA-Country headers
- **SSL Support** — optional HTTPS with certificate configuration
- **Access Links** — generate shareable, page-specific access links for the mail queue

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

# Install dependencies (runs install.js postinstall to validate paths)
npm install
```

### Docker Compose Deployment (Alternative)

You can also install, build, and deploy the admin web server using Docker Compose. This is ideal for isolated environments and handles dependency installation (including compiling binary SQLite dependencies) automatically.

#### Prerequisites

- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) installed on the host.

#### Steps

1. **Clone the project:**
   ```bash
   git clone <repository-url>
   cd mailpickupagent
   ```

2. **Deploy via Docker Compose:**
   ```bash
   docker compose up -d --build
   ```

3. **Verify the container is running:**
   ```bash
   docker compose ps
   ```

Once deployed, the admin UI will be accessible at `http://localhost:6245`.

#### Docker Mount Details

The provided `docker-compose.yml` mounts the following folders to persist data and integrate with MailEnable:
- `./config` mapped to `/usr/src/app/config` (persists settings, rules, SQLite sessions/subscriptions, and backups)
- `./logs` mapped to `/usr/src/app/logs` (persists daily processing logs)
- `./mail/quarantine` and `./mail/deleted` (persists quarantined/deleted emails)
- MailEnable inbound and logging directories mounted from their default paths (defined in `default.json`) into the container so the agent can scan inbound mail queues:
  - `C:/Program Files (x86)/Mail Enable/Queues/SMTP/Inbound/Messages` -> `/mailenable/queues/SMTP/Inbound/Messages`
  - `C:/Program Files (x86)/Mail Enable/Queues/SMTP/Inbound` -> `/mailenable/queues/SMTP/Inbound`
  - `C:/Program Files (x86)/Mail Enable/Logging/SMTP` -> `/mailenable/logging/SMTP`

*Note: The environment variable `NODE_ENV` inside the container is set to `docker`, which merges `config/default.json` with the path overrides configured in `config/docker.json`.*

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

Configuration changes are automatically backed up to timestamped `.bak` files in the `config/` directory. Old backups are pruned according to `BACKUP_MAX_COUNT` and `BACKUP_MAX_DAYS`.

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
| `SMTP_HOST` | `localhost` | MailEnable SMTP server host for sending test/released emails |
| `SMTP_PORT` | `25` | MailEnable SMTP server port |
| `SMTP_USER` | *(empty)* | SMTP authentication username |
| `SMTP_PASS` | *(empty)* | SMTP authentication password |
| `THRESHOLD_QUARANTINE` | `5` | Score at or above this value quarantines the email |
| `THRESHOLD_DELETE` | `15` | Score at or above this value deletes the email |
| `PROCESSING_LOG` | `./logs` | Directory for processing logs |
| `QUARANTINE_LOG` | `./logs` | Directory for quarantine logs |
| `SPAMASSASSIN_ENABLED` | `false` | Enable SpamAssassin spam checks |
| `SPAMASSASSIN_HOST` | `localhost` | SpamAssassin server hostname |
| `SPAMASSASSIN_PORT` | `783` | SpamAssassin server port |
| `AI_CHECK_ENABLED` | `false` | Enable AI spam classification |
| `AI_SPAM_CHECK_PROMPT_PATH` | `config/aiSpamCheckPrompt.md` | Path to the markdown-formatted AI spam checker prompt |
| `AI_SYSTEM` | `OLLAMA` | AI backend to use: `OLLAMA` or `LLAMACPP` |
| `OLLAMA_SERVER` | `localhost` | Ollama server hostname |
| `OLLAMA_PORT` | `11434` | Ollama server port |
| `OLLAMA_MODEL` | `llama3.2` | Ollama model name |
| `OLLAMA_TIMEOUT` | `5` | Ollama request timeout in seconds |
| `LLAMACPP_SERVER` | `localhost` | llama.cpp server hostname, IP, or URL |
| `LLAMACPP_PORT` | `8080` | llama.cpp server port (ignored when server includes a port) |
| `LLAMACPP_MODEL` | `llama3.2` | llama.cpp model name |
| `AI_SPAM_POINTS` | `5` | Points added when AI classifies as spam (× confidence) |
| `AI_HAM_POINTS` | `2.5` | Points subtracted when AI classifies as ham (× confidence) |
| `ABUSEIPDB_KEY` | *(empty)* | AbuseIPDB API key (check runs when set) |
| `ABUSEIPDB_TIMEOUT` | `5` | AbuseIPDB request timeout in seconds |
| `ABUSEIPDB_BASE_SCORE` | `5` | Minimum score assigned when IP has abuse reports |
| `ABUSEIPDB_MAX_SCORE` | `15` | Maximum score at 100% abuse confidence |
| `PURGE_EMAIL_AFTER_DAYS` | `30` | Retention for deleted emails (`npm run purge`) |
| `PURGE_LOG_AFTER_DAYS` | `30` | Retention for log files |
| `PURGE_INCLUDE_SMTP_LOGS` | `false` | Also purge MailEnable SMTP log files |
| `BACKUP_MAX_COUNT` | `5` | Maximum number of configuration backups to retain |
| `BACKUP_MAX_DAYS` | `90` | Maximum age of configuration backups in days |
| `TEST_EMAIL_SLEEP_SECONDS` | `3` | Delay between test emails |
| `TEST_EMAIL_FROM` | `"MailPickupAgent" <no-reply@localhost>` | From address used when sending test emails |
| `TEST_EMAIL_RECIPIENT` | `test@localhost` | Recipient for test emails |
| `CERT_KEY_PATH` | *(empty)* | Path to SSL private key (enables HTTPS) |
| `CERT_PATH` | *(empty)* | Path to SSL certificate (enables HTTPS) |
| `AUTH_USERNAME` | `admin` | Admin login username |
| `AUTH_PASSWORD_HASH` | *(default hash)* | Hashed admin password (salted scrypt) |
| `AUTH_SECRET` | *(auto-generated)* | Session encryption secret |

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

- **Status Dashboard** (`/status` or `/`) — server dashboard showing total processed, whitelisted, blacklisted, quarantined, released, pending queue count, service health (SpamAssassin, AI, AbuseIPDB), uptime, logged-in users, notification subscriptions, and auto-purge controls. This is the default landing page. Clickable cards navigate to related pages.
- **Configuration Editor** (`/configEditor`) — view and edit all settings with auto-backup on save
- **Configuration History** (`/configHistory`) — browse, diff, restore, and delete automatic configuration backups
- **Quarantine Manager** (`/mailq`) — review, release, or delete quarantined emails
- **Deleted Email Viewer** (`/deleted`) — browse and recover deleted emails with date filtering
- **Processing Log** (`/MailLog`) — view daily processing logs with result filtering (whitelisted, blacklisted, released, quarantined) and date filtering
- **Quarantine Log** (`/QuarantineLog`) — view quarantine action logs with date filtering
- **SMTP Log Analyzer** (`/SMTPLog`) — analyze MailEnable SMTP logs
- **Rules Editor** (`/rulesEditor`) — manage whitelist, blacklist, keyword, combo, TLD, and country filters; generate keyword filters via AI
- **Rule Hits Report** (`/ruleHits`) — track, view, and clear hit counts for whitelist, blacklist, country, combo, and keyword filters to observe rule efficacy
- **Manage Access Links** (`/manageLinks`) — generate, view, and delete shareable access links for the mail queue
- **Notifications** (`/notificationsAdmin`) — view and manage browser push notification subscriptions
- **Session Manager** (`/sessions`) — view active admin sessions with login metadata (IP, user agent, identifier) and terminate sessions

### Screenshots

| | |
|---|---|
| ![Default Status Page](public/img/Screenshots/Default%20Status%20Page.png) | ![Configuration Editor](public/img/Screenshots/Configuration%20Editor.png) |
| Default landing page with server dashboard | View and edit all settings |
| ![Rules Editor](public/img/Screenshots/Rules%20Editor.png) | ![Quarantine Manager](public/img/Screenshots/Quarantine%20Log.png) |
| Manage whitelist, blacklist, and keyword filters | Review, release, or delete quarantined emails |
| ![Deleted Emails Recovery](public/img/Screenshots/Deleted%20Emails%20Recovery.png) | ![Processing Log](public/img/Screenshots/Mail%20Log%20-%20Email%20Analyzer.png) |
| Browse and recover deleted emails | View daily processing logs |
| ![Quarantine Log](public/img/Screenshots/Quarantine%20Log.png) | ![SMTP Log Analyzer](public/img/Screenshots/MailEnable%20SMTP%20Log%20viewer.png) |
| View quarantine action logs | Analyze MailEnable SMTP logs |
| ![Config History](public/img/Screenshots/Config%20History.png) | ![Rule Hits](public/img/Screenshots/Rule%20Hits.png) |
| Browse, diff, and restore configuration backups | Track and view rule hit counts |
| ![Rule Hits Chart](public/img/Screenshots/Rule%20Hits%20Chart.png) | ![Notifications Admin](public/img/Screenshots/Notifications%20Admin.png) |
| Visualize rule hit activity | Manage notification subscriptions |
| ![Session Manager](public/img/Screenshots/Session%20Manager.png) | | ![Manage Access Links](public/img/Screenshots/Mailq%20Link%20Generator.png)
| Manage active sessions | Manage Access Links to Mailq page per user | 

It is recommended that you use PM2 or a similar tool to ensure that the server is always running.  
Make sure to exclude logging directories and quarantine/deleted directories from any watch settings to avoid unnecessary restarts.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run email processing (pickup mode) |
| `npm run server` | Start the admin web server |
| `npm test` | Send test emails to verify configuration |
| `npm run purge` | Remove old deleted emails, log files, and config backups |
| `npm run wipeall` | Delete all quarantined and deleted emails and ALL log files |
| `npm run spamTest` | Test SpamAssassin to see if it is running and working |
| `npm run spamTest:dev` | Test SpamAssassin using `config/development.json` (Windows) |
| `npm run aiTest` | Test the configured AI spam classifier with spam and ham emails |
| `npm run aiTest:dev` | Test the AI classifier using `config/development.json` (Windows) |
| `npm run abuseipdbTest` | Test AbuseIPDB API connection and IP reputation checking |
| `npm run abuseipdbTest:dev` | Test AbuseIPDB using `config/development.json` (Windows) |
| `npm run lint` | Run ESLint on all source files |
| `npm run lint:fix` | Run ESLint with auto-fix |

### Test Emails

Send test emails to verify configuration:

```bash
npm test
```

Optional types: `good`, `quarantine`, `blacklist`:

```bash
npm test -- quarantine
```

### Test SpamAssassin

Send test spam email to verify SpamAssassin is installed and configured properly:

```bash
npm run spamTest
```

### Test AI Check

Test the configured Ollama or llama.cpp AI spam classifier with representative spam and legitimate email samples:

```bash
npm run aiTest
```

The configured AI server must be running. This command does not require `AI_CHECK_ENABLED` to be set because it calls the AI checker directly. Set the `AI_SYSTEM` configuration value to `OLLAMA` (default) or `LLAMACPP` to choose which backend to test.

Configuration is selected from the `NODE_ENV` environment variable; the `NODE_ENV` property inside `development.json` does not select that file. On Windows, use the development configuration with:

```bash
npm run aiTest:dev
```

### Test AbuseIPDB

Test the AbuseIPDB API connection by checking a clean IP (Google DNS) and a known malicious IP:

```bash
npm run abuseipdbTest
```

Requires `ABUSEIPDB_KEY` to be set in your configuration. The test verifies the API key is valid and that IP reputation lookups return expected results.

On Windows, use the development configuration with:

```bash
npm run abuseipdbTest:dev
```

### Purging Old Files

Remove deleted emails, log files, and configuration backups older than the configured retention period:

```bash
npm run purge
```

Also purges configuration backups exceeding `BACKUP_MAX_COUNT` or older than `BACKUP_MAX_DAYS`.  
Schedule this command to run daily via Windows Task Scheduler or cron.

### Wipe All Data

Delete all emails in the quarantine and deleted directories as well as all log files:

```bash
npm run wipeall
```

Use with caution — wiped emails cannot be recovered.

## Integration with MailEnable

MailEnable's Pickup Event fires for each incoming email, passing the message ID and queue type as arguments. There are two integration approaches:

### Option A: HTTP API (Requires Running Web Server) (Recommended)

Requires the web server (`node server.js`) to be running continuously. Set MailEnable's pickup event to call `mailServerPickup.bat`:

```
C:\path\to\mailpickupagent\mailServerPickup.bat
```

This batch file sends a POST request to `http://localhost:6245/api/process` with the message ID and queue type. The web server must already be started (consider using PM2 to ensure it is always running).

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
| `POST` | `/api/wipeall` | Delete all logs, quarantined, and deleted emails |
| `GET` | `/api/spam-reason/:type/:id` | Get spam reason for a quarantined/deleted email |
| `GET` | `/api/email-lookup/:id` | Look up email by ID across quarantine and deleted directories |
| `POST` | `/status/api/purge` | Trigger manual purge |
| `POST` | `/status/api/reset-stats` | Reset live processing statistics metrics to zero |
| `POST` | `/status/api/ai-test` | Trigger an asynchronous/direct AI classification and connection test |
| `POST` | `/status/api/sa-test` | Trigger a connection and scan test for the SpamAssassin service |
| `POST` | `/status/api/abuseipdb-test` | Trigger a reputation API connection test with AbuseIPDB |
| `GET` | `/status/events` | Server-Sent Events (SSE) stream for real-time dashboard status updates |
| `GET` | `/notifications/public-key` | Get VAPID public key for push subscriptions |
| `POST` | `/notifications/subscribe` | Subscribe to quarantine push notifications |
| `POST` | `/notifications/unsubscribe` | Unsubscribe from push notifications |
| `GET` | `/notifications/check` | Check if an endpoint is subscribed |
| `GET` | `/notificationsAdmin/count` | Get subscription count |
| `GET` | `/configHistory/api/backups` | List configuration backup files |
| `GET` | `/configHistory/api/backup/content` | View backup file content |
| `GET` | `/configHistory/api/current` | View current rules or settings |
| `POST` | `/configHistory/api/restore` | Restore configuration from a backup |
| `DELETE` | `/configHistory/api/backup` | Delete a configuration backup |
| `GET` | `/rulesEditor/api/rules` | Get current rules (`rules.json`) content |
| `POST` | `/rulesEditor/api/rules/save` | Save updated rules to `rules.json` with automatic backup |
| `GET` | `/rulesEditor/api/rule-hits` | Get simple object mapping rules to hit counts |
| `POST` | `/rulesEditor/api/rules/generate-keyword-filter` | Generate a keyword filter via AI (Ollama or llama.cpp) |
| `GET` | `/ruleHits/api/rule-hits` | Get detailed list of rule hits with resolved display labels and scores |
| `DELETE` | `/ruleHits/api/rule-hits/clear` | Clear all recorded rule hits from database |
| `DELETE` | `/ruleHits/api/rule-hits/:ruleType/:ruleValue` | Delete a specific rule hit count from database |

## GeoIP Database

This project includes a `GeoLite2-Country.mmdb` file for IP-to-country lookups used by country-based filtering rules. The database may become outdated over time. For the most up-to-date IP geolocation data, download a free copy from MaxMind:

[https://www.maxmind.com/en/geolite-free-ip-geolocation-data](https://www.maxmind.com/en/geolite-free-ip-geolocation-data)

Replace the existing `GeoLite2-Country.mmdb` file in the project root with the downloaded version.

## Dependencies

- **axios** — HTTP client for Ollama and llama.cpp APIs
- **better-sqlite3** — SQLite database for sessions and notification subscriptions
- **better-sqlite3-session-store** — Express session store backed by SQLite
- **collections** — Data structure utilities (maps, sets, heaps)
- **cookie-parser** — HTTP cookie parsing middleware
- **express** — Web server framework
- **express-session** — Session management middleware
- **mmdb-reader** — GeoIP country lookup
- **moment** — Date/time formatting and manipulation
- **nodemailer** — SMTP email sending
- **postal-mime** — Email parsing
- **pug** — Template engine for admin UI
- **spamassassin-client** — SpamAssassin SPAMC protocol client
- **web-push** — Web push notification sending (VAPID)
- **xss** — Input sanitization to prevent XSS attacks

## License

ISC
