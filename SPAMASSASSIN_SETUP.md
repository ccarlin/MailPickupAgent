# SpamAssassin Setup Guide

## Quick Start

### 1. Enable SpamAssassin in Your Environment

```batch
set SPAMASSASSIN_ENABLED=true
set SPAMASSASSIN_HOST=localhost
set SPAMASSASSIN_PORT=783
```

### 2. Verify SpamAssassin (spamd) is Running

SpamAssassin must be running as a service before processing emails:

```bash
# Check if spamd is running on port 783
netstat -an | findstr 783
```

### 3. Test the Integration

Run with a test email:

```bash
node index.js ./test-WmBTMH/header.txt ./test-WmBTMH/msg.txt
```

You should see SpamAssassin logs like:
```
SpamAssassin score: 2.5/5.0, isSpam: false
```

## Installation on Windows

### Option 1: Using Chocolatey (Recommended)

```powershell
choco install spamassassin
```

Then start spamd:
```powershell
spamd.exe -d
```

### Option 2: Manual Installation

1. Download from [apache.org](https://spamassassin.apache.org/)
2. Extract to a directory (e.g., `C:\spamassassin`)
3. Run: `spamd.exe`

### Option 3: Windows Service (Auto-Start)

Create a batch file `start-spamd.bat`:
```batch
@echo off
C:\path\to\spamassassin\spamd.exe -d
```

Schedule it to run at startup via Task Scheduler or Windows Services.

## Configuration

### Connection Settings

| Variable | Default | Purpose |
|----------|---------|---------|
| `SPAMASSASSIN_ENABLED` | false | Enable/disable SpamAssassin checking |
| `SPAMASSASSIN_HOST` | localhost | spamd server address |
| `SPAMASSASSIN_PORT` | 783 | spamd server port |

### In Your Environment

#### Windows (Command Prompt)
```batch
setx SPAMASSASSIN_ENABLED true
setx SPAMASSASSIN_HOST localhost
setx SPAMASSASSIN_PORT 783
```

#### Windows (PowerShell)
```powershell
$env:SPAMASSASSIN_ENABLED = "true"
$env:SPAMASSASSIN_HOST = "localhost"
$env:SPAMASSASSIN_PORT = "783"
```

#### .bat Launch Script
Create `run-with-sa.bat`:
```batch
@echo off
set SPAMASSASSIN_ENABLED=true
set SPAMASSASSIN_HOST=localhost
set SPAMASSASSIN_PORT=783
node index.js %1 %2
```

Then use: `run-with-sa.bat /path/to/header /path/to/message`

## Troubleshooting

### SpamAssassin Unavailable Error

If you see `SpamAssassin connection error`:

1. Verify spamd is running: `netstat -an | findstr 783`
2. Check if SpamAssassin is installed: `which spamd` (Linux) or check Program Files
3. Start spamd manually: `spamd.exe -d` or restart the service
4. Verify firewall isn't blocking port 783

### High CPU Usage

spamd uses Perl and can consume resources. Consider:
- Running spamd on a separate machine
- Adjusting SpamAssassin rules
- Setting resource limits if running as a service

### How the Agent Handles Failures

- **Connection timeout (5s)**: Email proceeds through other checks
- **Connection refused**: Email continues, other checks applied
- **Invalid response**: Email continues, other checks applied
- **If disabled**: SpamAssassin check is skipped entirely

## Email Processing Flow

```
Email Received
    ↓
1. Check Whitelist (sender, IP) → Release or continue
    ↓
2. Check Blacklist (sender, subject, IP, country, combos) → Quarantine or continue
    ↓
3. SpamAssassin Check (if enabled) → Quarantine or continue
    ↓
4. Ollama AI Classification (if enabled) → Quarantine or continue
    ↓
5. Default: Release Email
```

## Performance Notes

- SpamAssassin check: ~1-2 seconds per email (with timeout)
- Runs only if `SPAMASSASSIN_ENABLED=true`
- Non-blocking: Errors don't stop email processing
- Recommended: Run spamd with `--allow-tells` for training (optional)

## Additional SpamAssassin Options

For advanced configuration, edit SpamAssassin config files:
- Windows: `C:\spamassassin\conf\local.cf`
- Linux: `/etc/spamassassin/local.cf`

Common tweaks:
```
# Adjust spam threshold (default 5.0)
required_score 4.0

# Enable specific rules
score RULE_NAME 1.5

# Disable specific checks
header UNWANTED_RULE off
```

## Monitoring

Enable verbose logging in your batch script:
```batch
set DEBUG=1
node index.js %1 %2
```

Check the quarantine/release directories to verify SpamAssassin decisions:
```bash
dir quarantine
dir release
```

## References

- [SpamAssassin Official](https://spamassassin.apache.org/)
- [SpamAssassin Rules](https://wiki.apache.org/spamassassin/)
- [SPAMC Protocol](https://spamassassin.apache.org/full/3.4.x/spamc.html)
