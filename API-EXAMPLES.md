# Mail Pickup Agent API - Quick Examples

## Starting the Web Service

```bash
npm run server
# Server will start on http://localhost:3000
```

## Example Requests

### 1. Get Help
```bash
curl http://localhost:3000/api/help | jq
```

### 2. View Current Configuration
```bash
curl http://localhost:3000/api/config | jq
```

### 3. Send Test Emails
```bash
# Using defaults
curl http://localhost:3000/api/test-emails

# To specific recipient
curl "http://localhost:3000/api/test-emails?recipient=test@example.com"
```

### 4. Dry Run (Simulation Mode)
Test rule matching without modifying files:
```bash
curl -X POST http://localhost:3000/api/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.MAI",
    "simulate": true
  }'
```

### 5. Dry Run (With File Copy)
Test and copy files to dry-run output directory:
```bash
curl -X POST http://localhost:3000/api/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.MAI",
    "simulate": false
  }'
```

### 6. Process Email
Apply all rules and quarantine/delete as needed:
```bash
curl -X POST http://localhost:3000/api/process \
  -H "Content-Type: application/json" \
  -d '{
    "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.H00",
    "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.MAI"
  }'
```

## PowerShell Examples

### Test with PowerShell
```powershell
$uri = "http://localhost:3000/api/help"
Invoke-RestMethod -Uri $uri -Method Get | ConvertTo-Json -Depth 10

$uri = "http://localhost:3000/api/config"
Invoke-RestMethod -Uri $uri -Method Get | ConvertTo-Json -Depth 10
```

### Process Email with PowerShell
```powershell
$uri = "http://localhost:3000/api/process"
$body = @{
    controlFilePath = "C:\MailEnable\Queue\SMTP\Outgoing\test.H00"
    messagePath = "C:\MailEnable\Queue\SMTP\Outgoing\test.MAI"
} | ConvertTo-Json

$result = Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType "application/json"
$result | ConvertTo-Json -Depth 10
```

## Response Examples

### Success Response (GET endpoints)
```json
{
  "message": "Test email process started",
  "testCount": 6,
  "details": [
    {
      "name": "blacklist-sender",
      "from": "bad@spam.test",
      "subject": "Test blacklist sender"
    }
  ]
}
```

### Success Response (POST endpoints)
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "controlFilePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.H00",
  "messagePath": "C:\\MailEnable\\Queue\\SMTP\\Outgoing\\test.MAI",
  "status": "queued",
  "message": "Email processing has been queued"
}
```

### Error Response
```json
{
  "error": "Missing required parameters",
  "required": ["controlFilePath", "messagePath"]
}
```

## Configuration Reloading

To reload the configuration after modifying rules.json, simply restart the server:

```bash
# Stop the current server (Ctrl+C)
# Then restart
npm run server
```

The new configuration will be loaded at startup.

## Checking Server Status

```bash
# Simple health check
curl -I http://localhost:3000/api/help

# Get full help information
curl http://localhost:3000/api/help | jq .
```

## Using with cURL Options

### Pretty print JSON output
```bash
curl http://localhost:3000/api/config | jq .
```

### Save response to file
```bash
curl http://localhost:3000/api/config > config_dump.json
```

### Show response headers
```bash
curl -i http://localhost:3000/api/config
```

### Include request headers
```bash
curl -v http://localhost:3000/api/config
```

## API Response Status Codes

- `200 OK` - Request successful (GET requests)
- `202 Accepted` - Processing queued (POST requests)
- `400 Bad Request` - Missing/invalid parameters
- `404 Not Found` - Files not found
- `500 Internal Server Error` - Server error

## Integration with MailEnable

The Mail Pickup Agent works with MailEnable by:

1. **Processing Queue** - Receives .MAI and .H00 files from MailEnable SMTP queue
2. **Rules Evaluation** - Applies whitelist/blacklist/keyword rules
3. **Action** - Quarantines suspicious emails or deletes based on rules
4. **Dry Run** - Test rules without affecting actual mail flow

## Notes

- Configuration is loaded **once at startup** for optimal performance
- Email processing and test email sending are **asynchronous**
- File paths must be absolute paths (C:\path\to\file on Windows)
- The API returns immediately; processing happens in the background
- Check server console logs for detailed processing information
