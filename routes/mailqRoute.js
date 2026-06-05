const express = require('express');
const router = express.Router();
const fs = require("fs");
const path = require("path");
const dns = require('dns');
const tools = require("../tools");
const dnsPromises = dns.promises;
const xss = require("xss");
const axios = require("axios");

const prefixUTF = '=?UTF-8?B?';
const suffix = '?=';
const prefixBase64 = '?BASE64?B?';
const prefixLatin = "=?UTF-8?Q?";
//TODO - Get these values from config or environment variables
const mailLogFile = "FIX ME";
const emailConfigPath = path.join(__dirname, '..', 'public', 'config', 'email.json');

function reasonText(action) {
    const edActions = new Set(['whitelist', 'blacklist']);
    return edActions.has(action) ? `Manually ${action}ed` : `Manually ${action}d`;
}

let msprvs1IDs = [];
let msgIDCache = [];

router.post('/', async function(req, res) {   // changed to async
    let bodyPostBack = req.body;
    let action = bodyPostBack.action.toLowerCase().split(" ")[0];
    let path = req.app.locals.spamPath;
    let mailLog = req.app.locals.logPath + "\\" + mailLogFile;
    let mailErrorDB = req.app.locals.mailErrorDB;

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

            let msg = `${email.reason} email with subject: ${data[i+1][1]}, from ${data[i+2][1]}, to recipient(s): ${data[i+3][1]}, dkim: ${data[i+8][1]}<br>Spam Score: ${data[i+4][1]}, Spam Classification: ${data[i+5][1]}`;
           
            updateLogFile(mailLog, msg, ipAddress);
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
            ReleaseMessages(req, emails, mailErrorDB);
            break;
        case "delete":
            DeleteMessages(emails, mailErrorDB, path);
            break;
        case "clear":            
            clearLogFile(mailLog);
            clearCache(mailErrorDB);
            break;  
        case "filter":
            res.clearCookie("MailQUserFilter");
            res.redirect('/mailq');
            return;
        case "whitelist":
            if (await addGoodEntries(emails, req))
                ReleaseMessages(req, emails, mailErrorDB);
            break;
        case "blacklist":
            if (await addBadComboEntries(emails, req))
                DeleteMessages(emails, mailErrorDB, path);
            break;
        default:
            //Do nothing
            break;        
    }

    res.redirect(req.get('Referrer') || '/');
});

router.post('/action', async function(req, res) {   // changed to async
    let bodyPostBack = req.body;
    let action = bodyPostBack.action.toLowerCase().split(" ")[0];
    let path = req.app.locals.spamPath;
    let mailLog = req.app.locals.logPath + "\\" + mailLogFile;
    let mailErrorDB = req.app.locals.mailErrorDB;

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
    let msg = `${email.reason} email with subject: ${email.subject}, from ${email.from}, to recipient(s): ${email.recipients}, dkim: ${email.dkim}<br>Spam Score: ${email.spamScore}, Spam Classification: ${email.antiSpam}`;
    updateLogFile(mailLog, msg, "N/A");
        
    switch(action)
    {
        case "release":
            ReleaseMessages(req, emails, mailErrorDB);
            break;
        case "delete":
            DeleteMessages(emails, mailErrorDB, path);
            break;
        case "clear":            
            clearLogFile(mailLog);
            clearCache(mailErrorDB);
            break;  
        case "filter":
            res.clearCookie("MailQUserFilter");
            res.redirect('/mailq');
            return;
        case "whitelist":
            if (await addGoodEntries(emails, req))
                ReleaseMessages(req, emails, mailErrorDB);
            break;
        case "blacklist":
            if (await addBadComboEntries(emails, req))
                DeleteMessages(emails, mailErrorDB, path);
            break;
        default:
            //Do nothing
            break;        
    }

    res.redirect(req.get('Referrer') || '/');
});

router.post('/performAICheck', async function (req, res) {
    try {
        const filePath = req.body.filepath; // Extract filePath from the request body

        if (!filePath) {
            return res.status(400).json({ success: false, message: 'filePath is required' });
        }

        // Perform the AI check logic
        const email = { filepath: filePath }; // Create an email object with the filepath
        const aiCheckResult = await isEmailSpamAICheck(email, req); // Call the AI check function

        // Return the result of the AI check
        return res.json({ success: true, result: aiCheckResult });
    } catch (error) {
        console.error('Error in performAICheck:', error);
        return res.status(500).json({ success: false, message: 'An error occurred while performing the AI check' });
    }
});

/* Display Main page */
router.get('/', function(req, res) {

    let filterUser = req.query.user ? String(req.query.user).toLowerCase() : null;

    //If the key is in the query string then set the cookie and redirect
    if (req.query.key)
    {
        res.cookie("MailKey", req.query.key, {maxAge: 1000 * 60 * 1440 * 365});    
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

    getEmails(req.app.locals.spamPath, async function(err, emails)
    {
        // If a filter was provided, restrict the set of emails before processing
        if (filterUser) {
            emails = emails.filter(e => {
                if (!e.recipients) return false;
                return e.recipients.toLowerCase().includes(filterUser);
            });
        }

        emails = await processEmails(req, emails);
        let now = new Date().toLocaleString();
        let mailLog = [];
        let filePath = req.app.locals.logPath + "\\" + mailLogFile;
        if (fs.existsSync(filePath))
        {
            mailLog = fs.readFileSync(filePath).toString();
            mailLog = prettyDisplay(mailLog);
        }   
             
        // Pass the filter to the view so it can show the current filter if desired
        let title = "Mail Quarentine";
        if (filterUser) 
            title += ` - ${filterUser}`;
        if (filterUser && filterUser != "all")
            res.render('mailqCard', { title, emails, currentTime: now, mailLog, filterUser });    
        else
            res.render('mailq', { title, emails, currentTime: now, mailLog, filterUser});
    });    
}); 

function prettyDisplay(logText)
{
    let output = "";
    logText = xss(logText);
    let logLines = logText.split('\n');
    for(let i=0;i<logLines.length;i++)
    {
        let line = logLines[i];
        if (line.length > 0) {           
            if ((line.includes("removing")) || (line.includes("deleted"))) 
            {
                if (line.includes("blocked subject"))
                    line = `<span style="color: maroon;">${line}</span>`;
                else if (line.includes("blocked sender"))
                    line = `<span style="color: orange;">${line}</span>`;
                else if (line.includes("Manually"))
                    line = `<span style="color: purple;">${line}</span>`;
                else
                    line = `<span style="color: red;">${line}</span>`;
            }
            else if ((line.includes("allowing good")) || (line.includes("released")))
                line = `<span style="color: green;">${line}</span>`;          
            
            output = line + "<br>" + output;
        }
    }
    return output;
}

//Check for bad senders and subjects to auto purge 
async function processEmails(req, emails) {
    let path = req.app.locals.spamPath;
    let filePath = req.app.locals.logPath + "\\" + mailLogFile;
    let mailErrorDB = req.app.locals.mailErrorDB;
    for(let i=0;i<emails.length;i++) 
    {
        let email = emails[i];
        let msg = "";
        //Allow for at most 2 non-ascii characters.
        // eslint-disable-next-line no-control-regex
        let asciiSubject = email.subject.replace(/[^\x00-\x7F]/g, "");
        let lengthTest = asciiSubject.length + 4;
            
        let spamDetails = `<br>DKIM: ${email.dkim}, Spam Score: ${email.spamScore}, Spam Classification: ${email.antiSpam}`;          
        }
    
    return displayEmails;
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
function buildSystemPrompt(email, messageText) {
    return `You are an expert in email analysis. 

    Email Header Information:
    Sender: ${email.sender}
    Recipients: ${email.recipients}
    Subject: ${email.subject}
    DKIM: ${email.dkim}
    Content: ${messageText}

    INSTRUCTIONS:
    1. Analyze this email and identify if it exhibits any common characteristics of spam.
    2. Look for signs of spam, such as suspicious sender addresses, urgent language, excessive exclamation points
       unusual attachments, or links that don't align with the sender's domain, and provide a conclusion on whether it is likely spam. 
    3. If it is spam, provide a reason why it is spam. 
    4. If it is not spam, provide a reason why it is not spam. 
    5. If you are unsure, please say so. If the email is in a foreign language, please translate it to English and then analyze it. 
    6. Output Requirements: Respond with: Spam Likelihood: High / Medium / Low\r\n Reasoning: A concise explanation referencing email content, headers, subject, and IP characteristics. Final Determination: “Spam” or “Not Spam”
    4. Respond in this EXACT JSON format (no markdown, no extra text):
    {
        "spamLikelihood": "High / Medium / Low",
        "reasoning": "Brief explanation of why you came to the conclusion, referencing specific email content, headers, subject, and IP characteristics.",
        "notes": "Any important notes or warnings (optional)"
    }

    Rules:
    - Do not respond with anything other than the specified JSON format. 
    - Do not include any explanations, disclaimers, or additional text outside of the JSON response.`;    
}

///Check if AI thinks this is spam or not
async function isEmailSpamAICheck(email, req)
{
    // TODO: Borrow the Querymind AI logic for building the prompt to use.
    // TODO: Look into increasing the token size for ollama to allow for more content to be analyzed.     
    const ollama_site = req.app.locals.ollamSite;
    let ollama_model = req.app.locals.ollamaEmail;
    if (ollama_site && (ollama_model.length > 0))
    {        
        let retValue = await checkCache(email.filepath,  req.app.locals.mailErrorDB);
        if (retValue == "")
        {
            //Get mail message if it exists
            let mailFile = req.app.locals.spamPath + "\\" + email.filepath + ".MAI";
            const mailMessage = await tools.emailExtract(mailFile, true);
            
            try 
            {
                let startTime = performance.now();
                let requestURL = ollama_site + "/api/generate";
                let message = buildSystemPrompt(email, mailMessage);
                let response = await axios.post(requestURL, {model: ollama_model, prompt: message, stream: false});
                retValue = response.data.response;               

                let endTime = performance.now()    
                let totalTime = endTime - startTime;
                let results = `AI check completed. AI timing: ${totalTime} milliseconds `;
                tools.logData(results, "INFO", req.socket.remoteAddress);
                updateCache(email.filepath, retValue, req.app.locals.mailErrorDB);
            } 
            catch (err) {
                tools.logWarn(`Unable to check email with AI. Error: ${err}`, "127.0.0.1");    
                return "Offline";   
            }
        }               
        
        return retValue;                
    }
    else
        return "Offline";
}

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
                        if (lines[j].startsWith("X-MXScan"))
                        {
                            let data = lines[j].split(": ");
                            let key = data[0].substring(9);
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
                                case "AntiSpam":
                                    emailInfo.antiSpam = value.replace("KEYWORD [Pass], ", "").replace("RDNSBL [Pass], ", "").replace("URLBL [Pass], ", "").replace("SPAMASSASSIN [0.0], ", "").replace(", DCC_CHECK [NA]", "").replace(", DCC_CHECK [Pass]", "");
                                    nFound++;            
                                    break;                               
                            }                
                        }
                        else if (lines[j].startsWith("DKIM-Signature"))
                            emailInfo.dkim = true;
                        else if (lines[j].startsWith("From: "))
                            emailInfo.from = lines[j].substring(6);

                        //Abort once all values are found
                        if (nFound > 2)
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
            tools.logWarn(`Unable to get IPInfo on email message: ${err}`, "127.0.0.1");
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
function DeleteMessages(emails, mailErrorDB, path)
{
    for (let i=0;i<emails.length;i++)
    {        
        //Test parameters
        let email = emails[i];
        let messageFile = path + "\\" + email.filepath;
        let headerFile = messageFile + ".H00";
        let emailFile = messageFile + ".MAI";
        try 
        {
            //Clean up files
            fs.unlinkSync(headerFile);
            fs.unlinkSync(emailFile);
        }
        catch(err) {
            tools.logError(`Unable to delete email: ${err}`, "127.0.0.1");
        }
    }
    storeDBInfo(emails, mailErrorDB);
}

//Release the message back to the queue to be delivered
function ReleaseMessages(req, emails, mailErrorDB)
{
    let path = req.app.locals.spamPath;
    
    for (let i=0;i<emails.length;i++)
    {
        let email = emails[i];
        let headerFile = path + "\\" + email.filepath + ".H00";
        let emailFile = path + "\\" + email.filepath + ".MAI";
        let newEmailFile = emailFile.replace(req.app.locals.spamPath, req.app.locals.recoverPath);
        let commandFile = emailFile.replace(req.app.locals.spamPath, req.app.locals.commandPath);
            
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
            tools.logError(`Unable to release email. Error: ${err}`, "127.0.0.1");
        }
    }  
    storeDBInfo(emails, mailErrorDB);
}

//Add a new entry to the log file
function updateLogFile(logFile, logLine, ipAddress)
{
    tools.logWarn(logLine, ipAddress);
    let timestamp = new Date().toLocaleString();
    let data = `${timestamp}\t${logLine}\n`;
    if (fs.existsSync(logFile))
        fs.appendFileSync(logFile, data);
    else
        fs.writeFileSync(logFile, data);
}

//Clears the content of the mail log file.
function clearLogFile(logFile)
{
    let data = "";
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
            tools.logData(`Unsubscribe request for ${filepath || 'unknown'} => ${url} returned ${resp.status}`, "INFO", req.socket.remoteAddress);
            return res.json({ success: true, status: resp.status });
        } catch (err) {
            // try GET as fallback
            try {
                const resp2 = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'HomeSite/1.0' } });
                tools.logData(`Unsubscribe GET fallback for ${filepath || 'unknown'} => ${url} returned ${resp2.status}`, "INFO", req.socket.remoteAddress);
                return res.json({ success: true, status: resp2.status });
            } catch (err2) {
                tools.logWarn(`Unsubscribe failed for ${url}: ${err.message}`, req.socket.remoteAddress);
                return res.json({ success: false, message: err2 && err2.message ? err2.message : err.message });
            }
        }
    } catch (ex) {
        tools.logError(`Error handling unsubscribe: ${ex}`, req.socket.remoteAddress);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
});

function parseEmailAddress(email) {
    // Simple regex to extract email address from possible formats
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const match = email.match(emailRegex);
    return match ? match[0] : null;
}

async function addGoodEntries(emails, req) {
    try {
        const raw = fs.readFileSync(emailConfigPath, 'utf8');
        const j = JSON.parse(raw);
        j.good = j.good || [];

        const added = [];
        emails.forEach(email => {
            const sender = parseEmailAddress((email.sender || '').trim());
            if (!sender) return;
            // recipients may be comma-separated; use each recipient token
            const recipients = String(email.recipients || '').split(',').map(r => r.trim()).filter(Boolean);
            recipients.forEach(recipient => {
                if (!recipient) return;
                const duplicate = j.good.some(g =>
                    String(g.recipient || '').toLowerCase() === recipient.toLowerCase()
                    && String(g.sender || '').toLowerCase() === sender.toLowerCase()
                );
                if (!duplicate) {
                    const newEntry = { recipient: recipient.toUpperCase(), sender: sender.toUpperCase() };
                    j.good.push(newEntry);
                    try { 
                        goodCombos.push(newEntry); 
                    } 
                    catch (e) 
                    {
                        tools.logError(`Error updating goodCombos in memory: ${e}`, req.socket.remoteAddress);
                    }
                    added.push(newEntry);
                }
            });
        });

        if (added.length > 0) {
            fs.writeFileSync(emailConfigPath, JSON.stringify(j, null, 2), 'utf8');
            tools.logData(`Added ${added.length} good combos`, "INFO", req.socket.remoteAddress);
            return true;
        } else {
            tools.logData(`No new good combos to add`, "INFO", req.socket.remoteAddress);
            return false;
        }
    } catch (err) {
        tools.logError(`Error adding good combos: ${err}`, req.socket.remoteAddress);
        return false;
    }
}

async function addBadComboEntries(emails, req) {
    try {
        const raw = fs.readFileSync(emailConfigPath, 'utf8');
        const j = JSON.parse(raw);
        j.combo = j.combo || [];

        const added = [];
        emails.forEach(email => {
            const sender = parseEmailAddress((email.sender || '').trim());            
            if (!sender) return;
            const recipients = String(email.recipients || '').split(',').map(r => r.trim()).filter(Boolean);
            recipients.forEach(recipient => {
                if (!recipient) return;
                const duplicate = j.combo.some(c =>
                    String(c.recipient || '').toLowerCase() === recipient.toLowerCase()
                    && String(c.sender || '').toLowerCase() === sender.toLowerCase()
                );
                if (!duplicate) {
                    const newEntry = { recipient: recipient.toUpperCase(), sender: sender.toUpperCase() };
                    j.combo.push(newEntry);
                    try { 
                        badCombos.push(newEntry); 
                    } 
                    catch (e) 
                    {
                        tools.logError(`Error updating badCombos in memory: ${e}`, req.socket.remoteAddress);
                    }
                    added.push(newEntry);
                }
            });
        });

        if (added.length > 0) {
            fs.writeFileSync(emailConfigPath, JSON.stringify(j, null, 2), 'utf8');
            tools.logData(`Added ${added.length} bad combos`, "INFO", req.socket.remoteAddress);
            return true;
        } else {
            tools.logData(`No new bad combos to add`, "INFO", req.socket.remoteAddress);
            return false;
        }
    } catch (err) {
        tools.logError(`Error adding bad combos: ${err}`, req.socket.remoteAddress);
        return false;
    }
}

module.exports = router;