const express = require('express');
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dns = require('dns');
const tools = require("../app/tools");
const metrics = require('../app/metrics');
const config = require('../config');
const { recentlyReleased } = require('../index.js');
const dnsPromises = dns.promises;
const PostalMime = require('postal-mime').default;

const prefixUTF = '=?UTF-8?B?';
const suffix = '?=';
const prefixBase64 = '?BASE64?B?';
const prefixLatin = "=?UTF-8?Q?";
const quarentineLogPath = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${config.QUARANTINE_LOG}/quarantine-${y}${m}${day}.log`;
};
const rulesConfigPath = path.join(__dirname, '..', 'config', 'rules.json');

function reasonText(action) {
    const edActions = new Set(['whitelist', 'blacklist']);
    return edActions.has(action) ? `${action}ed` : `${action}d`;
}

router.post('/', async function(req, res) {
    let bodyPostBack = req.body;
    let action = bodyPostBack.action.toLowerCase().split(" ")[0];
    let path = config.QUARANTINE_DIR;
    let mailLog = quarentineLogPath();

    let allData = bodyPostBack.data || {};
    let emails = [];
    for (let filepath of Object.keys(allData)) {
        if (bodyPostBack[filepath] !== "on") continue;
        let entry = allData[filepath];
        let email = {
            filepath: filepath,
            subject: entry.subject || '',
            sender: entry.sender || '',
            recipients: entry.recipients || '',
            spamScore: entry.spamScore || '',
            antiSpam: entry.antiSpam || '',
            clientip: entry.clientip || 'N/A',
            date: entry.datetime || '',
            dkim: entry.dkim == null ? '' : String(entry.dkim),
            reason: reasonText(action),
        };
        emails.push(email);

        updateLogFile(mailLog, {
            reason: email.reason,
            subject: email.subject,
            sender: email.sender,
            recipients: email.recipients,
            spamScore: email.spamScore,
            antiSpam: email.antiSpam,
            dkim: email.dkim,
            clientip: email.clientip
        });
    }

    switch(action)
    {
        case "release":
            ReleaseMessages(emails);
            break;
        case "delete":
            DeleteMessages(emails, path);
            break;
        case "filter":
            res.clearCookie("MailQUserFilter");
            res.redirect('/mailq');
            return;
        case "whitelist":
            if (await addSenderWhitelist(emails, bodyPostBack.listType))
                ReleaseMessages(emails);
            break;
        case "blacklist":
            if (await addSenderBlacklist(emails, bodyPostBack.listType))
                DeleteMessages(emails, path);
            break;
        default:
            //Do nothing
            break;        
    }

    res.redirect(req.get('Referrer') || '/');
});

router.post('/action', async function(req, res) {
    let bodyPostBack = req.body;
    let action = bodyPostBack.action.toLowerCase().split(" ")[0];
    let path = config.QUARANTINE_DIR;
    let mailLog = quarentineLogPath();

    let data = Object.entries(bodyPostBack);
    tools.logData(`Received action ${action} data_dump: ${data.join(', ')}`, "INFO");
    let email = {};
    
    email.reason = reasonText(action);
    for(let i=1;i<data.length;i++)
    {
        switch (data[i][0]) {           
            case "filePath":
                email.filepath = data[i][1];
                break;
            case "subject":
                email.subject = data[i][1];
                break;
            case "sender":
                email.sender = data[i][1];
                break;
            case "recipients":
                email.recipients = data[i][1];
                break;
            case "spamScore":
                email.spamScore = data[i][1];
                break;
            case "antiSpam":
                email.antiSpam = data[i][1];
                break;
            case "clientip":
                email.clientip = data[i][1];
                break;
            case "datetime":
                email.date = data[i][1];
                break;
            case "dkim":
                email.dkim = data[i][1];
                break;          
        }
    }

    let emails = [];
    emails.push(email);
    updateLogFile(mailLog, { reason: email.reason, subject: email.subject, sender: email.sender, recipients: email.recipients, spamScore: email.spamScore, antiSpam: email.antiSpam, dkim: email.dkim, clientip: "N/A" });
        
    switch(action)
    {
        case "release":
            ReleaseMessages(emails);
            break;
        case "delete":
            DeleteMessages(emails, path);
            break;
        case "filter":
            res.clearCookie("MailQUserFilter");
            res.redirect('/mailq');
            return;
        case "whitelist":
            if (await addSenderWhitelist(emails, bodyPostBack.listType))
                ReleaseMessages(emails);
            break;
        case "blacklist":
            if (await addSenderBlacklist(emails, bodyPostBack.listType))
                DeleteMessages(emails, path);
            break;
        default:
            //Do nothing
            break;        
    }

    res.redirect(req.get('Referrer') || '/');
});

/* Display Main page */
router.get('/', function(req, res) {

    let filterUser = req.query.user ? String(req.query.user).toLowerCase() : null;

    //If not logged in via session, handle key-based auth
    if (!req.session?.authenticated)
    {
        //If the key is in the query string then validate and set the cookie
        if (req.query.key || req.query.Key)
        {
            const keyVal = req.query.key || req.query.Key;
            // Validate the key before accepting it
            req.cookies.MailKey = keyVal;
            if (tools.isValid(req, "mailq")) {
                res.cookie("MailKey", keyVal, {maxAge: 1000 * 60 * 1440 * 365});
            } else {
                // Invalid key - clear any existing cookie and reject
                delete req.cookies.MailKey;
                res.clearCookie("MailKey");
                return res.redirect("/");
            }
            //If the user is passed with the key then set that cookie as well
            if (filterUser)
            {
                //The all value clears the cookie
                if (filterUser == "all")
                    res.clearCookie("MailQUserFilter");
                else
                    res.cookie("MailQUserFilter", req.query.user, { maxAge: 1000 * 60 * 1440 * 365 });
            }        
            return res.redirect("/mailq");
        }

        //Check if this is a valid connection if not send home..
        if (tools.isValid(req, "mailq") == false)
            return res.redirect("/");
    }
    
    // Optional filter parameter to only process/display emails for a specific user
    // Accepts ?user=<value> (matches against the recipients field)    
    if (filterUser && filterUser == "all")
    {
        filterUser = null;
        res.clearCookie("MailQUserFilter");
    }
    else if (filterUser) {
        res.cookie("MailQUserFilter", filterUser, { maxAge: 1000 * 60 * 1440 * 365 });
        tools.logData(`Mail Queue applying filter for user: ${filterUser}`, "INFO", req.socket.remoteAddress);
    }
    else if (req.cookies.MailQUserFilter) {
        // Use existing cookie value if no filter provided in query
        filterUser = String(req.cookies.MailQUserFilter).toLowerCase();        
    }

    getEmails(config.QUARANTINE_DIR, async function(err, emails)
    {
        // If a filter was provided, restrict the set of emails before processing
        if (filterUser) {
            emails = emails.filter(e => {
                if (!e.recipients) return false;
                return e.recipients.toLowerCase().includes(filterUser);
            });
        }

        let now = new Date().toLocaleString();              
        let title = "Mail Quarentine";
        if (filterUser) 
            title += ` - ${filterUser}`;
        if (filterUser && filterUser != "all")
            res.render('mailqCard', { title, emails, currentTime: now, filterUser });    
        else
            res.render('MailqGrid', { title, emails, currentTime: now, filterUser});
    });    
}); 

//Get the quarentined emails to be processed
function getEmails(emailPath, callback)
{
    var emailList = [];
    
    fs.readdir(emailPath, async function (err, list) 
    {
        if (err == null)
        {
            for(var i=0; i<list.length; i++) 
            {
                if(path.extname(list[i]).toLowerCase() === ".h00") 
                {
                    let emailInfo = {};
                    let filePath = emailPath + "//" + list[i];
                    let emailFilePath = filePath.toLowerCase().replace(".h00", ".mai");
                    let emailContents = fs.readFileSync(emailFilePath).toString();
                    let headerContents = fs.readFileSync(filePath).toString();
                    let lines = headerContents.split('\r\n');
                    emailInfo.filepath = list[i].slice(0, -4);
                    emailInfo.subject = "";
                    for(var j=0;j<lines.length;j++)
                    {
                        let data = lines[j].split(/=(.+)/);
                        let key = data[0];
                        let value = data[1];
                        switch (key)
                        {
                            case "Recipients":
                                value = GetEmailRecipient(value, true);
                                emailInfo.recipients = value;
                                break;
                            case "TimeAcquired":
                                emailInfo.TimeAcquired = value;
                                var utcSeconds = parseInt(value);
                                var d = new Date(0); // The 0 there is the key, which sets the date to the epoch
                                d.setUTCSeconds(utcSeconds);
                                emailInfo.date = d.toLocaleString();
                                break;
                            case "ClientIP":                               
                                emailInfo.clientip = value;                                
                                break;
                            case "Subject":
                                emailInfo.subject = GetSubject(value);
                                break;
                            case "Sender":
                                if (!emailInfo.sender) {
                                    value = GetEmailRecipient(value, false);
                                    emailInfo.sender = value;
                                }
                                break;
                            case "FromAddr":
                                emailInfo.sender = value;
                                break;                            
                        }
                    }
                    try {
                        const parsed = await PostalMime.parse(emailContents);
                        emailInfo.dkim = 'false';
                        for (const h of parsed.headers) {
                            switch (h.key) {
                                case 'x-mpa-msgid':
                                    emailInfo.msgid = h.value;
                                    break;
                                case 'x-mpa-spamscore':
                                    emailInfo.spamScore = h.value;
                                    break;
                                case 'x-mpa-spamdetail':
                                    emailInfo.antiSpam = h.value;
                                    break;
                                case 'x-mpa-spamreason':
                                    emailInfo.reason = h.value;
                                    break;
                                case 'dkim-signature':
                                    emailInfo.dkim = 'true';
                                    break;
                                case 'from':
                                    emailInfo.from = h.value;
                                    break;
                                case 'list-unsubscribe':
                                    emailInfo.unsubscribe = parseUnsubscribeHeader(h.value);
                                    break;
                            }
                        }
                    } catch (parseErr) {
                        tools.logError(`Failed to parse email ${emailFilePath}: ${parseErr}`);
                    }
                    emailList.push(emailInfo);                    
                }
            }
        }

        //Once we have all the data go get the updated info..
        GetClientInfo(emailList).then(function(newList){
            callback(err, newList); 
        });        
    });    
}

//Lookup the IP/DNS Information for this email
async function GetClientInfo(infoList) 
{
    for(let i=0;i<infoList.length;i++)
    {
        let ip = infoList[i].clientip;
        try
        {
            let results = await dnsPromises.reverse(ip);
            let domain = results[0];
            infoList[i].clientipinfo = 'Domain: ' + domain 
            let returnData = await dnsPromises.lookup(domain);
            infoList[i].safe = (ip==returnData.address);
            infoList[i].clientipinfo += ', IP: ' + returnData.address + ', IP-DNS Match:' + (ip==returnData.address).toString();
        }
        catch(err)
        {
            tools.logWarn(`Unable to get IPInfo on email message: ${err}`);
        }
    }

    return infoList;
}

//Parse Subject Translate encoded values
function GetSubject(value)
{
    let subject = value;      
    let capValue = value.toUpperCase();
    //Check if we are encoded
    if (capValue.includes(prefixUTF) || capValue.includes(prefixBase64) || capValue.includes(prefixLatin))                            
    {
        let prefix = capValue.includes(prefixUTF) ? prefixUTF : prefixBase64;                                    
        let encoding = "base64";
        if (capValue.includes(prefixLatin))
        {
            prefix = prefixLatin;
            encoding = "latin1";
        }                                    
        let startLoc = capValue.indexOf(prefix) + prefix.length;
        let endLoc = capValue.indexOf(suffix);
        //Check for backwards wrappering and swap them.
        if (endLoc < startLoc)
        {
            let piece1 = value.substring(0, endLoc);
            let p1Buff = Buffer.from(piece1, encoding);
            piece1 = p1Buff.toString('utf-8');
            let piece2 = value.substring(endLoc + suffix.length, startLoc - prefix.length);
            let piece3 = Buffer.from(value.substring(startLoc, value.length), encoding).toString('utf-8');
            subject = piece1 + piece2 + piece3
        }
        else
        {
            let newString = value.substring(startLoc, endLoc);
            let buff = Buffer.from(newString, encoding);  
            let text = buff.toString('utf-8');
            subject = text;                         
        }
    }   
    //Clean up strings that are still encoded.                            
    if (subject.includes("="))
    {
        let pieces = subject.replace(/_/g, " ").split("=");
        subject = pieces[0];
        for(let i=1;i<pieces.length;i++)
        {
            let hexValue = pieces[i].substring(0, 2);
            let asciiValue = Buffer.from(hexValue, "hex").toString("utf-8");
            subject += asciiValue + pieces[i].substring(2);
        }
    }
    
    return subject;
}

//Extract the recipient
function GetEmailRecipient(emailList, bFirstOnly)
{
    let retValue = "";
    let pieces = emailList.split(/[:;\]]/);
    for(let i=0;i<pieces.length;i++)
    {
        let piece = pieces[i];
        if (piece.length > 0)
        {
            if (piece.includes("@"))
            {
                if (retValue.Length > 0)
                    retValue += ", ";
                if (bFirstOnly)
                    retValue += piece.split('@')[0].toLowerCase();
                else
                    retValue += piece;
            }
        }
    }

    return retValue;
}

//Delete the email permenantly
function DeleteMessages(emails, sourcePath)
{
    const deletedDir = config.DELETED_DIR;
    if (!fs.existsSync(deletedDir)) {
        fs.mkdirSync(deletedDir, { recursive: true });
    }
    for (let i=0;i<emails.length;i++)
    {
        let email = emails[i];
        let headerFile = path.join(sourcePath, email.filepath + ".H00");
        let emailFile = path.join(sourcePath, email.filepath + ".MAI");
        let destHeader = path.join(deletedDir, email.filepath + ".H00");
        let destMessage = path.join(deletedDir, email.filepath + ".MAI");
        try
        {
            fs.renameSync(headerFile, destHeader);
            fs.renameSync(emailFile, destMessage);
            metrics.increment('deleted');
        }
        catch(err) {
            tools.logError(`Unable to move email to the delete directory: ${err}`);
        }
    }
}

//Release the message back to the queue to be delivered
function ReleaseMessages(emails)
{    
    let spamPath = config.QUARANTINE_DIR;
    
    for (let i=0;i<emails.length;i++)
    {
        let email = emails[i];
        let headerFile = spamPath + "\\" + email.filepath + ".H00";
        let emailFile = spamPath + "\\" + email.filepath + ".MAI";
        let newEmailFile = emailFile.replace(spamPath, config.SMTP_QUEUE_DIR);
        let commandFile = emailFile.replace(spamPath, config.SMTP_COMMAND_DIR);
            
        //Change the status of the message
        try {
            let commandText = fs.readFileSync(headerFile);
            commandText = commandText.toString().replace("Status=Delivering", "Status=UnDelivered");
            fs.writeFileSync(headerFile, commandText);

            //Clean up the files..
            fs.renameSync(emailFile, newEmailFile);
            fs.renameSync(headerFile, commandFile);
            recentlyReleased.set(email.filepath, Date.now());
            metrics.increment('released');
        }
        catch (err)
        {
            tools.logError(`Unable to release email. Error: ${err}`);
        }
    }  
}

function updateLogFile(logFile, entry)
{
    let timestamp = new Date().toLocaleString();
    let esc = v => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    let data = [timestamp, esc(entry.reason), esc(entry.subject), esc(entry.sender), esc(entry.recipients), esc(entry.spamScore), esc(entry.antiSpam), esc(entry.dkim), esc(entry.clientip)].join('\t') + '\n';
    if (fs.existsSync(logFile))
        fs.appendFileSync(logFile, data);
    else
        fs.writeFileSync(logFile, data);
}

// helper: parse List-Unsubscribe header value and return first usable URL or mailto
function parseUnsubscribeHeader(val) {
    if (!val) return null;
    val = String(val).trim().replace(/^"|"$/g, '');
    // split on commas (header may contain multiple <> values)
    const parts = val.split(/\s*,\s*/);
    // look for an http(s) url first inside angle brackets
    for (const p of parts) {
        const m = p.match(/<\s*(https?:\/\/[^>]+)\s*>/i);
        if (m) return m[1];
    }
    // then look for mailto inside angle brackets
    for (const p of parts) {
        const m = p.match(/<\s*(mailto:[^>]+)\s*>/i);
        if (m) return m[1];
    }
    // fallback to any http(s) token
    for (const p of parts) {
        const m = p.match(/(https?:\/\/\S+)/i);
        if (m) return m[1];
    }
    // fallback to first part
    return parts[0] || null;
}

// SSRF protection: check if a hostname/IP points to a private or internal address
function isPrivateHost(hostname) {
    var host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host === '::') return true;
    var ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
        var a = parseInt(ipv4[1], 10), b = parseInt(ipv4[2], 10);
        if (a === 0 || a === 10 || a === 127) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
    }
    return false;
}

// handle unsubscribe requests from client
router.post('/unsubscribe', async function(req, res) {
    try {
        if (tools.isValid(req, "mailq") == false)
            return res.status(403).json({ success: false, message: 'Not authorized' });

        const filepath = req.body.filepath || '';
        const url = req.body.url || '';

        if (!url) return res.status(400).json({ success: false, message: 'Missing unsubscribe URL' });

        // If mailto, instruct client to open mail client
        if (url.toLowerCase().startsWith('mailto:')) {
            return res.json({ success: false, message: 'mailto', info: url });
        }

        // Validate URL scheme
        var parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Invalid URL' });
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return res.status(400).json({ success: false, message: 'Only HTTP/HTTPS URLs are supported' });
        }

        // Block private/internal hosts by hostname
        if (isPrivateHost(parsedUrl.hostname)) {
            return res.status(400).json({ success: false, message: 'Requests to internal or private hosts are not allowed' });
        }

        // Resolve DNS and reject if any resolved IP is private (mitigates DNS rebinding)
        try {
            var addrs = await dnsPromises.resolve4(parsedUrl.hostname, { all: true });
            for (var i = 0; i < addrs.length; i++) {
                if (isPrivateHost(addrs[i].address)) {
                    tools.logWarn(`SSRF blocked: ${url} resolved to private IP ${addrs[i].address}`);
                    return res.status(400).json({ success: false, message: 'Unsubscribe URL resolves to a private address' });
                }
            }
        } catch (dnsErr) {
            tools.logWarn(`DNS lookup failed for unsubscribe URL ${parsedUrl.hostname}: ${dnsErr.message}`);
        }

        // attempt POST (many unsubscribe endpoints accept GET or POST; POST is safer for forms)
        try {
            const resp = await axios.post(url, {}, { timeout: 8000, maxRedirects: 5, headers: { 'User-Agent': 'HomeSite/1.0' } });
            tools.logData(`Unsubscribe request for ${filepath || 'unknown'} => ${url} returned ${resp.status}`, "INFO");
            return res.json({ success: true, status: resp.status });
        } catch (err) {
            // try GET as fallback
            try {
                const resp2 = await axios.get(url, { timeout: 8000, maxRedirects: 5, headers: { 'User-Agent': 'HomeSite/1.0' } });
                tools.logData(`Unsubscribe GET fallback for ${filepath || 'unknown'} => ${url} returned ${resp2.status}`, "INFO");
                return res.json({ success: true, status: resp2.status });
            } catch (err2) {
                tools.logWarn(`Unsubscribe failed for ${url}: ${err.message}`);
                return res.json({ success: false, message: err2 && err2.message ? err2.message : err.message });
            }
        }
    } catch (ex) {
        tools.logError(`Error handling unsubscribe: ${ex}`);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

function parseEmailAddress(email) {
    // Simple regex to extract email address from possible formats
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const match = email.match(emailRegex);
    return match ? match[0] : null;
}

async function addSenderWhitelist(emails, listType) {
    try {
        const raw = fs.readFileSync(rulesConfigPath, 'utf8');
        const rules = JSON.parse(raw);
        rules.whitelist = rules.whitelist || {};
        rules.whitelist.senders = rules.whitelist.senders || [];

        const added = [];
        emails.forEach(email => {
            const sender = parseEmailAddress((email.sender || '').trim());
            if (!sender) return;
            const entry = listType === 'domain' ? '@' + sender.split('@')[1].toLowerCase() : sender.toLowerCase();
            const duplicate = rules.whitelist.senders.some(s =>
                    typeof s === 'string' && s.toLowerCase() === entry.toLowerCase()
                );
            if (!duplicate) {
                rules.whitelist.senders.push(entry);
                added.push(entry);
            }
        });
        
        if (added.length > 0) {
            fs.writeFileSync(rulesConfigPath, JSON.stringify(rules, null, 2), 'utf8');
            tools.logData(`Added ${added.length} whitelist senders`, "INFO");
            return true;
        } else {
            tools.logData(`No new senders to add to whitelist`, "INFO");
            return false;
        }
    } catch (err) {
        tools.logError(`Error adding good combos: ${err}`);
        return false;
    }
}

async function addSenderBlacklist(emails, listType) {
    try {
        const raw = fs.readFileSync(rulesConfigPath, 'utf8');
        const rules = JSON.parse(raw);
        rules.blacklist = rules.blacklist || {};

        if (listType === 'domain') {
            rules.blacklist.senders = rules.blacklist.senders || [];
            const added = [];
            emails.forEach(email => {
                const sender = parseEmailAddress((email.sender || '').trim());
                if (!sender) return;
                const entry = '@' + sender.split('@')[1].toLowerCase();
                const duplicate = rules.blacklist.senders.some(s =>
                    typeof s === 'string' && s.toLowerCase() === entry.toLowerCase()
                );
                if (!duplicate) {
                    rules.blacklist.senders.push(entry);
                    added.push(entry);
                }
            });
            if (added.length > 0) {
                fs.writeFileSync(rulesConfigPath, JSON.stringify(rules, null, 2), 'utf8');
                tools.logData(`Added ${added.length} blacklist domain senders`, "INFO");
                return true;
            } else {
                tools.logData(`No new blacklist domain senders to add`, "INFO");
                return false;
            }
        } else {
            rules.blacklist.senders = rules.blacklist.senders || [];
            const added = [];
            emails.forEach(email => {
                const sender = parseEmailAddress((email.sender || '').trim());
                if (!sender) return;
                const entry = sender.toLowerCase();
                const duplicate = rules.blacklist.senders.some(s =>
                    typeof s === 'string' && s.toLowerCase() === entry.toLowerCase()
                );
                if (!duplicate) {
                    rules.blacklist.senders.push(entry);
                    added.push(entry);
                }
            });
            if (added.length > 0) {
                fs.writeFileSync(rulesConfigPath, JSON.stringify(rules, null, 2), 'utf8');
                tools.logData(`Added ${added.length} blacklist senders`, "INFO");
                return true;
            } else {
                tools.logData(`No new blacklist senders to add`, "INFO");
                return false;
            }
        }
    } catch (err) {
        tools.logError(`Error adding bad combos: ${err}`);
        return false;
    }
}

// SSE endpoint for real-time quarantine notifications
router.get('/events', function(req, res) {
    const filterUser = req.query.user ? String(req.query.user).toLowerCase() : null;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const sendEvent = (eventType, data) => {
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial connection confirmation
    sendEvent('connected', { filterUser });

    const onQuarantine = (emailInfo) => {
        // If a user filter is set, only notify if this mailbox is a recipient
        if (filterUser) {
            const recipients = (emailInfo.recipients || '').toLowerCase();
            if (!recipients.includes(filterUser)) return;
        }
        sendEvent('quarantine', emailInfo);
    };

    metrics.eventBus.on('quarantine', onQuarantine);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        metrics.eventBus.off('quarantine', onQuarantine);
        clearInterval(heartbeat);
    });
});

module.exports = router;