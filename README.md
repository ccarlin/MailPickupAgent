# Mail Pickup Agent for MailEnable

A Node.js executable that acts as a mail pickup agent for MailEnable, intercepting emails and routing them to quarantine or release based on configurable rules.

## Features

- Processes a single email from a MailEnable pickup invocation
- Accepts separate header and message files as command-line arguments
- Parses email content using mailparser
- Applies routing rules (whitelist/blacklist by sender, subject, IP, country, and combos)
- **SpamAssassin integration** with configurable enable/disable flag
- AI-powered spam classification using Ollama
- Routes to quarantine or release directories, or sends via SMTP

## Installation

1. Clone or download this project.
2. Run `npm install` to install dependencies.

## Configuration

Set environment variables:

- `QUARANTINE_DIR`: Directory for quarantined emails (default: ./quarantine)
- `RELEASE_DIR`: Directory for released emails (default: ./release)
- `DELETED_DIR`: Directory for deleted/sent emails (default: ./deleted)
- `SMTP_HOST`: SMTP host for releasing emails (default: localhost)
- `SMTP_PORT`: SMTP port (default: 25)
- `RELEASE_METHOD`: 'smtp' to send via SMTP, otherwise move to `RELEASE_DIR`
- `OLLAMA_HOST`: Ollama server host (default: localhost)
- `OLLAMA_PORT`: Ollama server port (default: 11434)
- `OLLAMA_MODEL`: Ollama model name (default: llama3.2)
- `SPAMASSASSIN_ENABLED`: Set to 'true' to enable SpamAssassin checking (default: false)
- `SPAMASSASSIN_HOST`: SpamAssassin (spamd) host (default: localhost)
- `SPAMASSASSIN_PORT`: SpamAssassin (spamd) port (default: 783)

## Usage

Process a single email using header and message file paths:

```bash
node index.js /path/to/header /path/to/message
```

Or with the installed CLI name:

```bash
mailpickup /path/to/header /path/to/message
```

## Integration with MailEnable

Configure MailEnable to invoke this agent directly with the header and message file paths for each email. The agent will process the message once and then exit.

## Dependencies

- nodemailer: For sending emails
- mailparser: For parsing email content

## SpamAssassin Integration

This agent can integrate with a local SpamAssassin instance for spam detection. SpamAssassin must be running as a service (`spamd`).

### Enabling SpamAssassin

Set the environment variable to enable SpamAssassin checking:

```bash
set SPAMASSASSIN_ENABLED=true
```

### Setting up SpamAssassin on Windows

1. **Install SpamAssassin** using a package manager or from [apache.org](https://spamassassin.apache.org/)
2. **Start the spamd service**:
   - Command line: `spamd.exe` (typically runs on localhost:783)
   - Or configure as a Windows service for automatic startup

3. **Test the connection**:
   ```bash
   node index.js /path/to/header /path/to/message
   ```
   With `SPAMASSASSIN_ENABLED=true`, you'll see SpamAssassin score logs in the console.

### Custom SpamAssassin Host/Port

If your SpamAssassin instance runs on a different host or port:

```bash
set SPAMASSASSIN_HOST=192.168.1.100
set SPAMASSASSIN_PORT=783
```

### How It Works

1. **Enabled Check**: If `SPAMASSASSIN_ENABLED` is set to 'true', the agent will attempt to connect to spamd
2. **Availability Flag**: If the connection fails or times out, the agent logs a warning but continues with other checks
3. **Spam Decision**: If SpamAssassin flags the email as spam (score >= threshold), the email is quarantined
4. **Fallback**: If SpamAssassin is unavailable, emails proceed through other checks (rules, AI classification)

## License

ISC