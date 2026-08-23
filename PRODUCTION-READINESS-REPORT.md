# Mail Pickup Agent - Production Readiness & Security Assessment Report

## Executive Summary

This report presents a security and production-readiness assessment of the **Mail Pickup Agent** application—a Node.js Express application that integrates with MailEnable's pickup event to perform multi-layered email spam filtering (rules, GeoIP, SpamAssassin, Ollama/llama.cpp AI, AbuseIPDB) and provides a web-based administration interface.

The application is architected to run internally alongside MailEnable, with optional external exposure of the administration web server. While the codebase demonstrates good software engineering practices (e.g., session management, synchronizer-token CSRF protection, input sanitization via `xss`, SQLite-backed persistence, structured logging, and configuration backup/rollback mechanisms), **it is NOT fully production-ready out-of-the-box for external web exposure without addressing key security vulnerabilities and configuration adjustments.**

This document provides a prioritized breakdown of **Critical**, **High**, **Medium**, and **Low** tasks required to ensure maximum security and operational stability prior to production deployment.

---

## Readiness Summary Matrix

| Category | Status | Summary |
|---|---|---|
| **Core Email Filtering (Pickup Event)** | **READY WITH CONFIGURATION** | Pickup event integration, headers, filtering logic, and rules engine are fully functional. |
| **Authentication & Access Control** | **ACTION REQUIRED** | Localhost & private IP authentication bypass mechanisms expose admin controls when behind reverse proxies. |
| **Transport Security (SSL/TLS)** | **USER RESPONSIBILITY** | SSL certificates must be supplied and configured; default settings run on plain HTTP (`PORT 6245`). |
| **Credentials & Secrets Management** | **ACTION REQUIRED** | Default admin password hash and session secret in `config/default.json` must be changed. |
| **Network & Input Security** | **ACTION REQUIRED** | Rate limiting, header security, CSRF exemptions, and SSRF mitigations require hardening. |

---

## 1. CRITICAL TASKS

Critical tasks represent severe security vulnerabilities that could allow unauthenticated remote administrative access, authentication bypass, session hijacking, or full server compromise—especially when the application is exposed externally or placed behind a reverse proxy.

### C-1: Remove or Restrict Unauthenticated Admin Access via Localhost Bypass
* **Location**: `middleware/auth.js` (`isLocalhost(req)`)
* **Vulnerability Description**:
  The authentication middleware automatically bypasses password authentication for any request originating from `localhost`, `127.0.0.1`, `::1`, or `::ffff:127.x.x.x`. When the web server is exposed externally behind a reverse proxy (e.g., IIS Application Request Routing (ARR), Nginx, Apache, Cloudflare Tunnel, HAProxy) running on the same host or in a containerized loopback network, incoming HTTP requests arrive at Node.js with `req.socket.remoteAddress` set to `127.0.0.1`.
* **Impact**:
  An unauthenticated external attacker accessing the website through a reverse proxy gains **full administrative privileges** without entering a username or password.
* **Remediation**:
  1. Remove automatic authentication bypass for administrative web routes in `middleware/auth.js`.
  2. Require full session authentication for all admin UI routes regardless of client IP address.
  3. If localhost bypass is required for internal CLI/IPC API calls (such as `/api/process`), isolate those API endpoints to explicit loopback-only route handlers rather than applying global bypasses to web routes.

---

### C-2: Fix Authentication Bypass for Private IP Addresses in Access Validation
* **Location**: `middleware/auth.js` and `app/tools.js` (`isValid` / `isPrivateIp`)
* **Vulnerability Description**:
  The `tools.isValid()` function evaluates whether a client is allowed to access access-controlled pages (such as `/mailq`). It returns `true` if `isPrivateIp(req.socket.remoteAddress)` evaluates to `true`.
* **Impact**:
  Any user connected to the internal network (ranges `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or any external user routed through an internal reverse proxy automatically bypasses access key checks, allowing unauthorized viewing, releasing, or deletion of quarantined emails.
* **Remediation**:
  1. Remove `isPrivateIp` auto-approval from `tools.isValid()`.
  2. Restrict access to `/mailq` strictly to valid authenticated admin sessions or valid, non-expired access keys stored in the database.

---

### C-3: Enforce Password & Session Secret Changes on Initial Deployment
* **Location**: `config/default.json`, `routes/auth.js`, `server.js`
* **Vulnerability Description**:
  The base configuration contains default credentials:
  * `AUTH_USERNAME`: `"admin"`
  * `AUTH_PASSWORD_HASH`: Salted scrypt hash corresponding to the default password `"admin"`.
  * `AUTH_SECRET`: `"change-this-to-a-random-secret-in-production"`
* **Impact**:
  If the application is started in production without updating `config/production.json` or setting environment variables, any user can log in using default credentials `admin / admin` or forge session cookies if `AUTH_SECRET` is left unchanged.
* **Remediation**:
  1. Implement a startup check in `server.js` that blocks startup or forces an initial setup prompt if `AUTH_PASSWORD_HASH` matches the default `"admin"` password hash or if `AUTH_SECRET` equals the default template string when `NODE_ENV=production`.
  2. Automatically generate a 256-bit cryptographically secure session secret if none is configured.
  3. Require administrators to change the default password during first login.

---

### C-4: Use Timing-Safe Comparisons for Password Verification
* **Location**: `middleware/hash.js` (`verifyPassword`)
* **Vulnerability Description**:
  Password verification compares derived key hashes using standard JavaScript string comparison operator (`===`).
* **Impact**:
  Standard string comparisons short-circuit on the first mismatched byte, exposing the verification process to timing side-channel attacks that could allow an attacker to reconstruct password hashes byte-by-byte.
* **Remediation**:
  Replace standard string comparison with Node.js built-in `crypto.timingSafeEqual(bufA, bufB)` after ensuring equal buffer lengths.

---

## 2. HIGH TASKS

High tasks represent security weaknesses or operational deficiencies that could lead to information disclosure, unauthorized actions, denial of service, or improper session/token management.

### H-1: Implement Expiration and Revocation Controls for Access Links
* **Location**: `routes/manageLinks.js`, `app/tools.js`, `middleware/auth.js`
* **Description**:
  Access keys generated via `/manageLinks` grant access to `/mailq` for specific recipients. Currently, keys are stored indefinitely in the SQLite `access_keys` table without an expiration timestamp (`expires_at`). Additionally, passing `?Key=...` stores the key in a persistent HTTP-only cookie (`MailKey`) without expiration constraints.
* **Impact**:
  A leaked access link grants permanent access to quarantined emails for that mailbox.
* **Remediation**:
  1. Add an `expires_at` column to `access_keys` and enforce expiration checks during validation in `tools.isValid()`.
  2. Provide options in `/manageLinks` to set key expiration (e.g., 24 hours, 7 days, 30 days, or single-use).
  3. Set explicit expiration (`maxAge`) on the `MailKey` cookie.

---

### H-2: Prevent Server-Side Request Forgery (SSRF) and DNS Rebinding
* **Location**: `routes/configEditor.js` (`getAiServerUrl`), `routes/rulesEditor.js` (`generate-keyword-filter`), `routes/mailqRoute.js` (`/unsubscribe`)
* **Description**:
  1. In `/unsubscribe`, user-supplied URLs are fetched using `axios`. Although hostname validation is present, HTTP redirects (up to 5) followed by `axios` can bypass hostname checks and hit internal metadata endpoints or private network services.
  2. In `generate-keyword-filter`, requests are dispatched to `OLLAMA_SERVER` without verifying if the target host resolves to prohibited internal or cloud metadata IP addresses (`169.254.169.254`).
* **Impact**:
  An attacker sending spam emails containing crafted unsubscribe links could force the mail server to perform internal network port scanning or access cloud instance metadata.
* **Remediation**:
  1. Disable automatic HTTP redirect following (`maxRedirects: 0`) in `axios` for unsubscribe requests, or validate the target IP of every redirect hop against private/loopback IP ranges.
  2. Apply `isDangerousTarget()` validation consistently to all outbound HTTP requests (Ollama, llama.cpp, AbuseIPDB, and Unsubscribe links).

---

### H-3: Secure HTTPS / TLS Configuration & Cookie Security
* **Location**: `server.js`, `config/default.json`
* **Description**:
  By default, the application runs over plain HTTP on port `6245` unless `CERT_PATH` and `CERT_KEY_PATH` are supplied. When running over HTTP:
  * Session cookies are transmitted without the `Secure` flag (`secure: false`).
  * Admin credentials and session tokens can be intercepted via network sniffing on unencrypted networks.
* **Impact**:
  Eavesdropping or man-in-the-middle (MITM) attacks when accessing the admin UI externally over HTTP.
* **Remediation**:
  1. For direct external exposure, mandate TLS configuration by supplying valid SSL/TLS certificates (`CERT_PATH` and `CERT_KEY_PATH`).
  2. When placed behind an SSL-terminating reverse proxy, configure Express to trust the proxy (`app.set('trust proxy', 1)`) and enforce `cookie.secure = true` when `X-Forwarded-Proto: https` is present.
  3. Enable HTTP Strict Transport Security (HSTS) headers when HTTPS is active.

---

### H-4: Apply Rate Limiting Across All Public & Administrative API Routes
* **Location**: `server.js`, `routes/auth.js`, `routes/configEditor.js`, `routes/manageLinks.js`
* **Description**:
  While rate limiting (`loginLimiter`) is implemented on POST `/login`, other state-changing routes (such as `/api/process`, `/configEditor/api/config/save`, `/manageLinks`, `/notifications/subscribe`) lack rate limiting.
* **Impact**:
  Susceptibility to brute-force attacks, denial-of-service (DoS) via resource exhaustion, or configuration flooding.
* **Remediation**:
  Apply global rate limiting using `express-rate-limit` across all `/api/` endpoints and sensitive form submission routes.

---

## 3. MEDIUM TASKS

Medium tasks address security hygiene, defense-in-depth, error handling, session hardening, and database stability.

### M-1: Sanitize Error Messages Sent to HTTP Clients
* **Location**: `server.js`, `routes/configEditor.js`, `routes/rulesEditor.js`, `routes/configHistory.js`
* **Description**:
  Several catch blocks return raw exception messages (`error.message`) to HTTP clients in JSON error responses (e.g. status 500 responses).
* **Impact**:
  Internal filesystem paths, database structure details, or stack trace fragments may be disclosed to external users.
* **Remediation**:
  In production (`NODE_ENV=production`), log detailed stack traces server-side via `tools.logError()` while returning generic error messages (e.g. `"An internal server error occurred"`) to HTTP clients.

---

### M-2: Harden Content Security Policy (CSP) & Remove Unsafe Directives
* **Location**: `server.js`
* **Description**:
  The Content Security Policy header includes:
  `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com`
  The `'unsafe-inline'` directive disables XSS protections for inline scripts, and trusting third-party CDNs introduces risks if CDN assets are compromised.
* **Impact**:
  Reduced defense against Cross-Site Scripting (XSS) attacks.
* **Remediation**:
  1. Refactor inline scripts into static JavaScript files located in `public/js/`.
  2. Implement script nonces (`res.locals.nonce`) or cryptographic hashes for necessary inline scripts.
  3. Self-host third-party scripts (e.g., FontAwesome, Grid.js) rather than relying on external CDNs.

---

### M-3: Harden Express Session Cookie Configuration
* **Location**: `server.js`
* **Description**:
  Session cookies are configured with `sameSite: 'lax'`. While `'lax'` provides protection against top-level cross-site GET requests, administrative actions performed via POST/PUT/DELETE can benefit from stricter cookie policies.
* **Impact**:
  Potential exposure to Cross-Site Request Forgery (CSRF) on legacy browser engines or secondary web contexts.
* **Remediation**:
  Set `sameSite: 'strict'` for administrative session cookies or make it configurable via settings.

---

### M-4: Implement Graceful Handling for SQLite Database Operations
* **Location**: `app/db.js`, `server.js`
* **Description**:
  Database operations (`better-sqlite3`) for sessions, push notifications, access keys, and rule hits execute synchronously. If the disk fills up or the SQLite database file experiences lock contention, uncaught synchronous exceptions can crash the Node.js process.
* **Impact**:
  Service interruption and potential mail pickup delays.
* **Remediation**:
  Wrap database initialization and write statements in try-catch blocks with appropriate retry logic or graceful fallback handling.

---

### M-5: Disable `X-Powered-By` Header
* **Location**: `server.js`
* **Description**:
  Express automatically broadcasts the `X-Powered-By: Express` HTTP response header unless explicitly disabled.
* **Impact**:
  Discloses technology stack details to automated scanners and attackers.
* **Remediation**:
  Add `app.disable('x-powered-by');` near the top of `server.js`.

---

## 4. LOW TASKS

Low tasks encompass code maintainability, dependency management, documentation, and non-critical operational enhancements.

### L-1: Configure Express `trust proxy` Setting for Reverse Proxy Deployments
* **Location**: `server.js`, `config/default.json`
* **Description**:
  When deployed behind an IIS, Nginx, or Apache reverse proxy, Express requires `app.set('trust proxy', ...)` to accurately extract client IP addresses from `X-Forwarded-For` headers.
* **Impact**:
  Inaccurate client IP logging in mail processing logs and session tracking when behind a reverse proxy.
* **Remediation**:
  Add a `TRUST_PROXY` configuration setting in `config/default.json` (e.g. `1` or `"loopback"`) and apply `app.set('trust proxy', appConfig.TRUST_PROXY)` in `server.js`.

---

### L-2: Update Node Dependencies & Perform Security Audit
* **Location**: `package.json`
* **Description**:
  Run dependency security audits (`npm audit`) and update core dependencies (`express`, `axios`, `nodemailer`, `postal-mime`, `pug`) to their latest stable releases to patch transitive vulnerabilities.
* **Remediation**:
  Execute `npm audit fix` and test all core email filtering and web UI features.

---

### L-3: Establish Automated Integration & Security Tests
* **Location**: `test/` directory, `package.json`
* **Description**:
  Currently, `npm test` executes email generation tests (`node index.js --test`), but there are no automated unit or integration tests for HTTP authentication, CSRF validation, route authorization, or configuration saving.
* **Remediation**:
  Add a lightweight test framework (e.g., `supertest` with `mocha` or `node:test`) to automatically verify route security, CSRF enforcement, and authentication checks.

---

### L-4: Add a Production Deployment Guide (`PRODUCTION.md`)
* **Location**: Repository root
* **Description**:
  The project README explains general configuration but lacks a dedicated guide for production hardening, reverse proxy setup, Windows service configuration (using PM2 or NSSM), and certificate binding.
* **Remediation**:
  Create `PRODUCTION.md` providing step-by-step instructions for:
  * Changing default passwords and secrets.
  * Setting up SSL/TLS certificates or configuring reverse proxies (IIS / Nginx).
  * Setting up process management (PM2 or Windows Service via NSSM).
  * Configuring firewall rules to restrict port 6245 access.

---

## Production Readiness Checklist

Before exposing the Mail Pickup Agent web interface externally or deploying into production, complete the following verification checklist:

- [ ] **Critical C-1**: Disabled global localhost authentication bypass for admin web routes.
- [ ] **Critical C-2**: Removed private IP address auto-approval in `tools.isValid()`.
- [ ] **Critical C-3**: Updated `AUTH_USERNAME`, changed `AUTH_PASSWORD_HASH` from default, and set a unique `AUTH_SECRET`.
- [ ] **Critical C-4**: Replaced string comparisons with `crypto.timingSafeEqual` in password verification.
- [ ] **High H-1**: Configured expiration dates for all generated access links.
- [ ] **High H-2**: Hardened outbound HTTP requests against SSRF and disallow redirects to private networks.
- [ ] **High H-3**: Bound SSL/TLS certificates or configured an HTTPS-terminating reverse proxy with `trust proxy`.
- [ ] **High H-4**: Enabled rate limiting across all API endpoints.
- [ ] **Medium M-1**: Sanitized internal error messages in production environment.
- [ ] **Medium M-2**: Strengthened Content Security Policy headers and self-hosted static assets.
- [ ] **Medium M-3**: Configured `SameSite=Strict` on session cookies.
- [ ] **Medium M-5**: Disabled `X-Powered-By` header in Express.
- [ ] **Low L-1**: Configured `trust proxy` in Express for accurate client IP resolution behind reverse proxies.
- [ ] **Low L-4**: Published `PRODUCTION.md` deployment and security guidelines.

---

*Report generated by Jules Security Audit Tool for Mail Pickup Agent v3.2.6.*
