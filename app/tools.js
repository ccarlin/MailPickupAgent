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
    logError: function(data) {
        this.logData(data, "ERROR");
    },
    logWarn: function(data) {
      this.logData(data, "WARN");
    },
    logData: function(data, level) {
      let message;

      if (!level)
        level = "INFO";

      if (data == null)
        data = "";

      let timestamp = new Date().toLocaleString();
      message = `${timestamp}\t[${level}]\tPID: ${process.pid}, IP: N/A\t${data}`;

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
    // Retrieve X-MPA-SpamReason header from an email by its ID and directory path.
    // Returns the spam reason string, or null if not found or on error.
    getSpamReason: async function(emailId, emailPath) {
        try {
            const mailFile = path.join(emailPath, emailId + '.MAI');
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
    buildFilePaths: function(messageID, queueType) {
        const qt = (queueType || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const queueDirKey = `${qt}_QUEUE_DIR`;
        const commandDirKey = `${qt}_COMMAND_DIR`;
        const messagePath = config[queueDirKey] ? path.join(config[queueDirKey], messageID) : messageID;
        const controlFilePath = config[commandDirKey] ? path.join(config[commandDirKey], messageID) : messageID;       
        return { messagePath, controlFilePath };
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
        //Create list of valid keys
        if (this.isPrivateIp(req.socket.remoteAddress)) 
          return true;     
        if (req.session?.authenticated)
          return true;
        else {
            const key = req.cookies.MailKey;
            let validPageKey = this.generateKey(req.socket.localAddress, null, pagePath);
            let validKey = this.generateKey(req.socket.localAddress);
            const validKeys = [validPageKey, validKey];
            // Also accept a user-tied key based on the MailQUserFilter cookie
            const userFilter = req.cookies.MailQUserFilter;
            if (userFilter) {
              validKeys.push(this.generateKey(req.socket.localAddress, null, `${pagePath}:${userFilter}`));
            }
            if (validKeys.includes(key))
              return true;
            else 
              this.logError(`Invalid or expired security key: ${req.cookies.MailKey}, for IP: ${req.socket.localAddress}, Accessing Page: ${req.originalUrl} PageKey: ${pagePath}`, req.socket.remoteAddress);            
        }
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
     * @returns {string} md5 hash key
     */
    generateKey: function(localAddress, remoteAddress, pagePath) {
      localAddress = localAddress || '';
      remoteAddress = remoteAddress || '';

      // base key includes local and optionally remote
      let base = remoteAddress ? `${localAddress}:${remoteAddress}` : `${localAddress}`;

      // if a pagePath is provided include it in the hash so the key is page-specific
      if (pagePath && pagePath !== '') {
        base += `:${pagePath}`;
      }

      return crypto.createHash('md5').update(base).digest("hex");
    }    
  }; 