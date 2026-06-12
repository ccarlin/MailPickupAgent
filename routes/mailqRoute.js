const express = require('express');
const router = express.Router();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const dns = require('dns');
const tools = require("../tools");
const config = require('../config');
const dnsPromises = dns.promises;

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

    let data = Object.entries(bodyPostBack);
    let emails = [];
    for(let i=1;i<data.length;i++)
    {
        //Only grab the email fields
        if (data[i][1] == "on")
        {
            let email = {};

            email.filepath = data[i][0];
            email.subject = data[i+1][1];
            email.sender = data[i+2][1];
            email.recipients = data[i+3][1];
            email.spamScore = data[i+4][1];
            email.antiSpam = data[i+5][1];
            email.date = data[i+7][1];
            email.dkim = data[i+8][1];
            email.aiCheck = data[i+9][1];
            email.reason = reasonText(action);
            let ipAddress = "N/A";
            try {
                email.clientip = data[i+6][1];
            }
            catch (err)
            {
                tools.logWarn(err, "N/A");
            }
            emails.push(email);

            updateLogFile(mailLog, { reason: email.reason, subject: data[i+1][1], sender: data[i+2][1], recipients: data[i+3][1], spamScore: data[i+4][1], antiSpam: data[i+5][1], dkim: data[i+8][1], clientip: ipAddress });
            i=i+9;
        }
        else 
        {
            i=i+8;
        }
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
            if (await addGoodEntries(emails))
                ReleaseMessages(emails);
            break;
        case "blacklist":
            if (await addBadComboEntries(emails))
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
            case "aiCheck":
                email.aiCheck = data[i][1];
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
            if (await addGoodEntries(emails))
                ReleaseMessages(emails);
            break;
        case "blacklist":
            if (await addBadComboEntries(emails))
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
    
    // Optional filter parameter to only process/display emails for a specific user
    // Accepts ?user=<value> (matches against the recipients field)    
    if (filterUser && filterUser == "all")
    {
        filterUser = null;
        res.clearCookie("MailQUserFilter");
    }
    else if (filterUser) {
        res.cookie("MailQUserFilter", filterUser, { maxAge: 1000 * 60 * 1440 * 365 });
        tools.logData(`Mail Queue applying filter for user: ${filterUser}`, "INFO");
    }
    else if (req.cookies?.MailQUserFilter) {
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
            res.render('mailq', { title, emails, currentTime: now, filterUser});
    });    
}); 

//Get the quarentined emails to be processed
function getEmails(emailPath, callback)
{
    var emailList = [];
    
    fs.readdir(emailPath, function (err, list) 
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
                                value = GetEmailRecipient(value, false);
                                emailInfo.sender = value;
                                break;                            
                        }
                    }
                    // also try to find List-Unsubscribe inside the full email content if not set
                    // only match if the line starts with "List-Unsubscribe:" (case-insensitive)
                    const m = emailContents.match(/^List-Unsubscribe:\s*(.+)$/im);
                     if (m && m[1]) {
                         emailInfo.unsubscribe = parseUnsubscribeHeader(m[1]);
                     }                    
                    lines = emailContents.split('\r\n');
                    emailInfo.dkim = false;
                    for(j=0;j<lines.length;j++)
                    {
                        let nFound = 0;
                        if (lines[j].startsWith("X-MPA"))
                        {
                            let data = lines[j].split(": ");
                            let key = data[0].substring(6);
                            let value = data[1];
                            switch (key)
                            {
                                case "Msgid":
                                    emailInfo.msgid = value;
                                    nFound++;
                                    break;
                                case "SpamScore":
                                    emailInfo.spamScore = value;
                                    nFound++;
                                    break;
                                case "SpamDetail":
                                    emailInfo.antiSpam = value.replace("KEYWORD [Pass], ", "").replace("RDNSBL [Pass], ", "").replace("URLBL [Pass], ", "").replace("SPAMASSASSIN [0.0], ", "").replace(", DCC_CHECK [NA]", "").replace(", DCC_CHECK [Pass]", "");
                                    nFound++;            
                                    break;       
                                case "SpamReason":
                                    emailInfo.reason = value;
                                    nFound++;                        
                            }                
                        }
                        else if (lines[j].startsWith("DKIM-Signature"))
                            emailInfo.dkim = true;
                        else if (lines[j].startsWith("From: "))
                            emailInfo.from = lines[j].substring(6);

                        //Abort once all values are found
                        if (nFound > 3)
                            break;
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
                    retValue += piece.split('@')[0];
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

        // attempt POST (many unsubscribe endpoints accept GET or POST; POST is safer for forms)
        try {
            const resp = await axios.post(url, {}, { timeout: 8000, headers: { 'User-Agent': 'HomeSite/1.0' } });
            tools.logData(`Unsubscribe request for ${filepath || 'unknown'} => ${url} returned ${resp.status}`, "INFO");
            return res.json({ success: true, status: resp.status });
        } catch (err) {
            // try GET as fallback
            try {
                const resp2 = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'HomeSite/1.0' } });
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

async function addGoodEntries(emails) {
    try {
        const raw = fs.readFileSync(rulesConfigPath, 'utf8');
        const rules = JSON.parse(raw);
        rules.whitelist = rules.whitelist || {};
        rules.whitelist.senders = rules.whitelist.senders || [];

        const added = [];
        emails.forEach(email => {
            const sender = parseEmailAddress((email.sender || '').trim());
            if (!sender) return;
            const duplicate = rules.whitelist.senders.some(s =>
                    typeof s === 'string' && s.toLowerCase() === sender.toUpperCase().toLowerCase()
                );
            if (!duplicate) {
                rules.whitelist.senders.push(sender.toUpperCase());
                added.push(sender.toUpperCase());
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

async function addBadComboEntries(emails) {
    try {
        const raw = fs.readFileSync(rulesConfigPath, 'utf8');
        const rules = JSON.parse(raw);
        rules.blacklist = rules.blacklist || {};
        rules.blacklist.combos = rules.blacklist.combos || [];

        const added = [];
        emails.forEach(email => {
            const sender = parseEmailAddress((email.sender || '').trim());            
            if (!sender) return;
            const recipients = String(email.recipients || '').split(',').map(r => r.trim()).filter(Boolean);
            recipients.forEach(recipient => {
                if (!recipient) return;
                const duplicate = rules.blacklist.combos.some(c =>
                    String(c.recipient || '').toLowerCase() === recipient.toLowerCase()
                    && String(c.sender || '').toLowerCase() === sender.toLowerCase()
                );
                if (!duplicate) {
                    const newEntry = { recipient: recipient.toUpperCase(), sender: sender.toUpperCase() };
                    rules.blacklist.combos.push(newEntry);
                    added.push(newEntry);
                }
            });
        });

        if (added.length > 0) {
            fs.writeFileSync(rulesConfigPath, JSON.stringify(rules, null, 2), 'utf8');
            tools.logData(`Added ${added.length} bad combos`, "INFO");
            return true;
        } else {
            tools.logData(`No new bad combos to add`, "INFO");
            return false;
        }
    } catch (err) {
        tools.logError(`Error adding bad combos: ${err}`);
        return false;
    }
}

module.exports = router;