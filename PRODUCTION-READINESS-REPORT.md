# Mail Pickup Agent - Production Readiness & Deployment Assessment Report

## Executive Summary

This report evaluates the production readiness and security posture of **Mail Pickup Agent** (v3.2.6), a Node.js Express application that integrates with MailEnable's pickup event to provide automated email spam filtering, quarantine management, and an administrative web interface.

The application is architected to support two primary deployment models:
1. **Local / Internal Deployment Mode (Standard Default)**: Designed for zero-friction execution directly alongside MailEnable on the mail server. In this mode, password-free local administrative access over loopback (`localhost`) is an intentional feature, allowing seamless local management without credentials. **The application is fully production-ready out-of-the-box for local/internal operation.**
2. **External Web Exposure Mode**: When the administrator chooses to expose the web interface to the public internet or publish it behind an external reverse proxy. In this mode, the administrator must configure credentials, transport security (SSL/TLS certificates), and network access rules.

The codebase includes strong built-in security mechanisms:
- **Synchronizer-token CSRF protection** auto-injected across all unsafe HTTP methods and client-side forms/AJAX.
- **Timing-safe password verification** using Node.js `crypto.timingSafeEqual` with salted scrypt key derivation.
- **Auto-generated cryptographically secure session secrets** stored in `config/.session-secret`.
- **SSRF and DNS-rebinding protection** on outbound web requests (List-Unsubscribe URL fetching and AI endpoints).
- **Mandatory password enforcement** before enabling SSL certificates in the UI.
- **Input sanitization** (`xss`) and parameterized SQLite database queries (`better-sqlite3`).

---

## Deployment Modes & Readiness Summary

| Deployment Context | Readiness Status | Summary |
|---|---|---|
| **Local / Internal Mode (Standard)** | **PRODUCTION READY** | Core email pickup processing, local queue management, rules engine, and password-free loopback admin access work out-of-the-box. |
| **External Exposure Mode** | **CONFIGURABLE BY USER** | Requires administrator setup: changing default admin credentials, binding SSL certificates (`CERT_PATH` / `CERT_KEY_PATH`), and configuring reverse proxy headers. |

---

## 1. CRITICAL TASKS
*Mandatory configuration tasks required ONLY if the administrator chooses to expose the web interface to the external public internet.*

### C-1: Set Custom Administrator Password for External Access
* **Context for Local Mode**: Not required. In local-only execution, loopback administration is designed for frictionless access.
* **Requirement for External Exposure**: If opening the web server to the public internet, the administrator must update the default admin password via the **Configuration Editor** (`/configEditor`) or in `config/production.json`.
* **Note**: The application UI actively blocks enabling SSL certificates unless the default admin password has been changed.

### C-2: Configure SSL/TLS Certificates or HTTPS Reverse Proxy
* **Context for Local Mode**: Not required when listening locally on loopback.
* **Requirement for External Exposure**: Web UI runs on plain HTTP (`PORT 6245`) by default. External web access requires encryption:
  - **Option A (Direct HTTPS)**: Supply valid SSL certificate and private key paths in configuration (`CERT_PATH` and `CERT_KEY_PATH`).
  - **Option B (Reverse Proxy)**: Place the application behind an HTTPS-terminating reverse proxy (such as IIS ARR, Nginx, Apache, or Cloudflare Tunnel).

### C-3: Configure Reverse Proxy Loopback Header Forwarding (`trust proxy`)
* **Context for Local Mode**: Not applicable.
* **Requirement for External Exposure**: When publishing the web UI externally via a local reverse proxy on the same host, incoming requests arrive at Express with `remoteAddress` as `127.0.0.1`. Configure Express trust proxy settings and ensure the reverse proxy properly forwards `X-Forwarded-For` and `X-Forwarded-Proto` headers while preventing header spoofing from untrusted external clients.

---

## 2. HIGH TASKS
*Important administrative and operational controls when exposing the web interface.*

### H-1: Manage and Periodically Audit Access Links (`/manageLinks`)
* **Context**: Access links generate security keys allowing specific users to manage quarantined emails for their address (`/mailq`).
* **Requirement**: Administrators should periodically review active access keys on the **Manage Links** page (`/manageLinks`), revoking any stale or unneeded keys.

### H-2: Restrict Direct Port Access via Firewall Rules
* **Context**: Node.js binds to port `6245` on network interfaces by default.
* **Requirement**: Configure Windows Firewall or Cloud Security Groups to restrict inbound traffic on port `6245` so that only local applications or authorized reverse proxies can reach the port.

### H-3: Secure Configuration & Mail Directory File Permissions
* **Context**: Configuration files (`config/production.json`, `config/.session-secret`, `config/rules.json`) store local path and credential details.
* **Requirement**: Restrict NTFS / Linux file permissions on the application folder exclusively to the service account running Node.js and MailEnable.

---

## 3. MEDIUM TASKS
*Session hygiene, retention policies, and defense-in-depth recommendations.*

### M-1: Ensure Proper HTTPS Session Cookie Flags Behind Proxies
* **Context**: When direct HTTPS is enabled (`CERT_PATH`), session cookies automatically set `secure: true`.
* **Requirement**: When running behind an external HTTPS reverse proxy, ensure `X-Forwarded-Proto: https` is forwarded so Express sets cookie `Secure` flags appropriately.

### M-2: Monitor and Terminate Active Sessions (`/sessions`)
* **Context**: The **Session Manager** UI (`/sessions`) displays active login sessions with client IP, user agent, login time, and identifier metadata.
* **Requirement**: Review active sessions periodically and use **Force Logout** to terminate unrecognized or stale sessions.

### M-3: Verify Log and Email Retention Schedules
* **Context**: Built-in retention settings (`PURGE_EMAIL_AFTER_DAYS`, `PURGE_LOG_AFTER_DAYS`, `BACKUP_MAX_COUNT`, `BACKUP_MAX_DAYS`) control disk cleanup.
* **Requirement**: Schedule `npm run purge` via Windows Task Scheduler or cron (or trigger manual purges from the Status page) to ensure disk space remains healthy.

---

## 4. LOW TASKS
*Operational maintenance and deployment best practices.*

### L-1: Register as a Windows Service / Background Process (PM2 or NSSM)
* **Context**: Production deployment requires automatic process restarting on server reboot.
* **Requirement**: Register `server.js` as a background service using PM2 or NSSM (Non-Sucking Service Manager) on Windows MailEnable hosts.

### L-2: Configure Antivirus Exclusions for Mail Queues
* **Context**: Real-time antivirus scanners can temporarily lock email files while MailEnable or Mail Pickup Agent moves them between queue directories.
* **Requirement**: Add exclusions in Windows Defender or enterprise antivirus for `./mail/quarantine`, `./mail/deleted`, and MailEnable queue paths.

### L-3: Routine Package Dependency Updates (`npm audit`)
* **Context**: Maintenance practice for third-party libraries over time.
* **Requirement**: Run `npm audit` periodically and update dependencies (`express`, `postal-mime`, `axios`, `better-sqlite3`).

---

## Production Deployment Checklist

### For Local / Internal Execution (Standard Default)
- [x] **Core Agent**: MailPickupAgent processing and MailEnable pickup integration active.
- [x] **Local Web UI**: Accessible on `http://localhost:6245` for friction-free local management.
- [ ] **Background Service**: Registered `node server.js` as a service via PM2 or NSSM.
- [ ] **Maintenance Schedule**: Scheduled `npm run purge` daily for log/email cleanup.

### Additional Steps for External Web Exposure
- [ ] **1. Change Password**: Update admin password via `/configEditor` or `config/production.json`.
- [ ] **2. Transport Security**: Bind SSL certificate paths (`CERT_PATH`, `CERT_KEY_PATH`) or configure an HTTPS reverse proxy.
- [ ] **3. Firewall Rules**: Restrict external access to port `6245` via Windows Firewall / Cloud NSG.
- [ ] **4. Reverse Proxy Headers**: Ensure `trust proxy` and `X-Forwarded-For` / `X-Forwarded-Proto` headers are correctly forwarded.

---

*Report generated by Jules Assessment Tool for Mail Pickup Agent v3.2.6.*
