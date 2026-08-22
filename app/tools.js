const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PostalMime = require('postal-mime');
const config = require('../config');

module.exports = {
    getSortedFiles: function(imageDir, fileType, sortType, callback) {        
        var files = [];
        var checkTypes = [];
        if (Array.isArray(fileType))
          checkTypes = fileType
        else 
          checkTypes.push(fileType);

        fs.readdir(imageDir, function (err, list) 
        {
          if (err == null)
          {
            for(let i=0; i<list.length; i++) 
            {   
              let currentType = path.extname(list[i]).toLowerCase();                          
              if(checkTypes.includes(currentType))
              {
                let fileInfo = {};
                fileInfo.name = list[i];              
                try {
                  if ((fileInfo.date == null) || (sortType == "ByLastUpdateDesc"))
                  {
                    let stats = fs.statSync(imageDir + '/' + list[i]);
                    if (sortType == "ByLastUpdateDesc") 
                      fileInfo.displayDate = stats.mtime;            
                    else 
                      fileInfo.displayDate = stats.birthtime;
                    fileInfo.date = fileInfo.displayDate.getTime();
                    fileInfo.displayDate = fileInfo.displayDate.toLocaleDateString();
                  }
                  fileInfo.caption = list[i].replace(fileType, "") + " - " + fileInfo.displayDate;
                  files.push(fileInfo);
                }
                catch(err)
                { 
                  module.exports.logError(err);
                }                
              }
            }
            files.sort(function (a, b) 
            {
              switch (sortType) {
                case "ByAlpha":
                  return a.name - b.name;
                case "ByDateDesc":
                case "ByDateTakenDesc":
                case "ByLastUpdateDesc":
                  return b.date - a.date;
                case "ByDate":
                default:
                  return a.date - b.date;                 
              }
            });
          }
          callback(err, files); 
        });        
    },   
    UpperCase: function(text) {
      let newText = text.charAt(0).toUpperCase() + text.slice(1);
      return newText;
    },
    logError: function(data, ipAddress) {
        this.logData(data, "ERROR", ipAddress);
    },
    logWarn: function(data, ipAddress) {
      this.logData(data, "WARN", ipAddress);
    },
    logData: function(data, level, ipAddress) {
      let message;

      if (!level)
        level = "INFO";

      if (data == null)
        data = "";

      const normalizedIp = (() => {
        let candidate = (ipAddress == null ? "127.0.0.1" : String(ipAddress)).trim();
        if (!candidate) return "127.0.0.1";
        candidate = candidate.replace(/^\[|\]$/g, '').split(',')[0].trim();
        if (!candidate) return "127.0.0.1";
        if (candidate === "::1" || candidate === "::") return "127.0.0.1";
        if (candidate.startsWith('::ffff:') && candidate.includes('.')) return candidate.replace(/^::ffff:/, '');
        return candidate;
      })();

      let timestamp = new Date().toLocaleString();
      message = `${timestamp}\t[${level}]\tPID: ${process.pid}, IP: ${normalizedIp}\t${data}`;

      //Don't log debug messages unless debugging..
      if (level == "ERROR") {
        console.error(message);
      }
      else if ((config.NODE_ENV == "development") || (level != "DEBUG"))
        console.info(message);      
    },    
    // Async: parse email file and return HTML/text as HTML.
    // Returns a Promise<string>. Callers should await this function.
    emailExtract: async function(mailFile, inHTML) {
      try {
        if (!fs.existsSync(mailFile)) {
          return "No message available";
        }
        const mailMessage = fs.readFileSync(mailFile);
        const parsed = await PostalMime.parse(mailMessage);
        if (inHTML) return parsed.html || "No HTML part available";
        const textContent = parsed.text || "";
        return textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>\n') || "No text available";
      } catch (err) {
        this.logError(`Error parsing email file: ${mailFile}, Error: ${err}`);
        return "Error parsing email message.";
      }
    },
    // Async: parse email and resolve CID image references to base64 data URIs.
    // Returns a Promise<string> of HTML with inline images embedded.
    emailExtractWithImages: async function(mailFile) {
      try {
        if (!fs.existsSync(mailFile)) {
          return "No message available";
        }
        const mailMessage = fs.readFileSync(mailFile);
        const parsed = await PostalMime.parse(mailMessage);
        let html = parsed.html || "";
        const attachments = parsed.attachments || [];
        if (!html || attachments.length === 0) return html || "No HTML part available";

        // Build a map of cid -> attachment content
        const cidMap = {};
        for (const att of attachments) {
          if (att.contentId) {
            // contentId may be wrapped in angle brackets
            const cid = att.contentId.replace(/^</, '').replace(/>$/, '');
            cidMap[cid] = att;
          }
        }

        // Replace cid: references with data URIs
        html = html.replace(/cid:([^"'\s>]+)/g, (match, cid) => {
          const att = cidMap[cid];
          if (att && att.content) {
            const b64 = Buffer.from(att.content).toString('base64');
            return `data:${att.contentType || 'application/octet-stream'};base64,${b64}`;
          }
          return match;
        });

        return html;
      } catch (err) {
        this.logError(`Error parsing email file with images: ${mailFile}, Error: ${err}`);
        return "Error parsing email message.";
      }
    },
    // Retrieve X-MPA-SpamReason header from an email by its ID and directory path.
    // Accepts either a bare hex ID ("ABC123") or a full filename ("ABC123.MAI").
    // Returns the spam reason string, or null if not found or on error.
    getSpamReason: async function(emailId, emailPath) {
        try {
            const id = String(emailId || '').replace(/\.MAI$/i, '');
            if (!/^[A-Fa-f0-9]+$/.test(id)) {
                return null;
            }
            const mailFile = path.join(emailPath, id + '.MAI');
            if (!fs.existsSync(mailFile)) {
                return null;
            }
            const mailContents = fs.readFileSync(mailFile);
            const parsed = await PostalMime.parse(mailContents);
            for (const h of parsed.headers) {
                if (h.key === 'x-mpa-spamreason') {
                    return h.value;
                }
            }
            return null;
        } catch (err) {
            this.logError(`Error getting spam reason for ${emailId}: ${err.message}`);
            return null;
        }
    },
    sleep: function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    MESSAGE_ID_PATTERN: /^[A-Fa-f0-9]+\.MAI$/i,
    resolveWithinDir: function(baseDir, fileName) {
        const base = path.resolve(baseDir);
        const resolved = path.resolve(base, fileName);
        const relative = path.relative(base, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`Invalid messageID: path escapes configured directory (${fileName})`);
        }
        return resolved;
    },
    buildFilePaths: function(messageID, queueType) {
        if (typeof messageID !== 'string' || !module.exports.MESSAGE_ID_PATTERN.test(messageID)) {
            throw new Error('Invalid messageID: must be a MailEnable message filename (hex ID ending in .MAI)');
        }

        const qt = (queueType || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const queueDirKey = `${qt}_QUEUE_DIR`;
        const commandDirKey = `${qt}_COMMAND_DIR`;
        const queueDir = config[queueDirKey];
        const commandDir = config[commandDirKey];

        if (!queueDir || !commandDir) {
            throw new Error(`Invalid queueType: no directories configured for ${qt}`);
        }

        return {
            messagePath: module.exports.resolveWithinDir(queueDir, messageID),
            controlFilePath: module.exports.resolveWithinDir(commandDir, messageID),
        };
    },
    isPrivateIp: function(ip) {
      // Check for IPv4 private ranges
      const privateRanges = [
        /^10\./, //
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0 - 172.31.255.255
        /^192\.168\./, // 192.168.0.0 - 192.168.255.255
        // IPv6 private / unique-local ranges
        /^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:/i, // fc00::/7 unique-local
        /^fe80:/i, // fe80::/10 link-local
        /^::1$/, // loopback
        // IPv4-mapped IPv6 private ranges
        /^::ffff:10\./,
        /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^::ffff:192\.168\./
      ];
      return privateRanges.some(range => range.test(ip));
    },
     //Validate the connection
    isValid: function(req, pagePath) {           
      try {
        if (this.isPrivateIp(req.socket.remoteAddress)) 
          return true;     
        if (req.session?.authenticated)
          return true;
        const key = req.cookies.MailKey;
        if (!key) return false;
        const db = require('./db');
        const row = db.prepare('SELECT * FROM access_keys WHERE key = ?').get(key);
        if (row) {
          req.keyInfo = row;
          db.prepare("UPDATE access_keys SET last_used_at = datetime('now'), usage_count = usage_count + 1 WHERE key = ?").run(key);
          return true;
        }
        this.logError(`Invalid or expired security key: ${(key ?? '').replace(/[^\x20-\x7e]/g, '')}, for IP: ${req.socket.localAddress}, Accessing Page: ${req.originalUrl} PageKey: ${pagePath}`, req.socket.remoteAddress);
      }
      catch (exp) {
        this.logError(`Unable to validate security key, exception: ${exp}`, req.socket.remoteAddress);            
      }

      return false;
    },
    /**
     * Generate an access key.
     * @param {string} localAddress
     * @param {string} remoteAddress
     * @param {string} [pagePath] Optional - if provided the key will be tied to a single page (include full path or identifier)
     * @returns {string} sha256 hash key
     */
    generateKey: function() {
      return crypto.randomBytes(32).toString('hex');
    },

    storeKey: function(key, label, userFilter) {
      const db = require('./db');
      db.prepare(`
        INSERT OR IGNORE INTO access_keys (key, label, user_filter, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(key, label || null, userFilter || null);
    },

    getStoredKeys: function() {
      const db = require('./db');
      return db.prepare('SELECT id, key, label, user_filter, created_at, last_used_at, usage_count FROM access_keys ORDER BY created_at DESC').all();
    },

    deleteStoredKey: function(id) {
      const db = require('./db');
      return db.prepare('DELETE FROM access_keys WHERE id = ?').run(id).changes > 0;
    }
  };

const db = require('./db');
db.prepare(`
  CREATE TABLE IF NOT EXISTS access_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT,
    user_filter TEXT,
    created_at TEXT,
    last_used_at TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0
  )
`).run(); 