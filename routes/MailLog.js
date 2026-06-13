const express = require('express');
const router = express.Router();
const path = require('path');
const tools = require("../tools");
const fs = require("fs");
const xss = require("xss");
const MMDBReader = require('mmdb-reader');
const mmdb = new MMDBReader(path.join(__dirname, '../GeoLite2-Country.mmdb'));
const config = require('../config');

/* Display Main page */
router.get('/', function(req, res) {

    const logPath = config.PROCESSING_LOG;
    const fileTypes = ".log";
   
    tools.getSortedFiles(logPath, fileTypes, "ByLastUpdateDesc", function (err, files) {
        //Process each log file
        let logList = [];
        let startTime = performance.now();
        for (let i=0; i<files.length; i++) 
        {
            let obj;
            let filePath = logPath + "\\" + files[i].name;
            //We only care about the message file..
            if (!filePath.includes("processing"))
                continue;
            if (fs.existsSync(filePath))
            {            
                let logText = fs.readFileSync(filePath).toString();
                logText = xss(logText);
                let logLines = logText.split('\n');
                //Process each log line
                for(let i=0;i<logLines.length;i++)
                {
                    let line = logLines[i];
                    //Skip blank and comment lines
                    if ((line.trim().length > 0) && (line.startsWith("#") == false)) 
                    {
                        let lineParts = line.split('\t');
                        let dateTime = lineParts[0];                        
                        if ((isNaN(Date.parse(dateTime))) || (lineParts.length < 13))
                            continue;
                        
                        let ipAddress = lineParts[5];

                        obj = {};                     
                        obj.ipAddress = ipAddress;   
                        obj.dateTime = dateTime;                    
                        let ipLookup = mmdb.lookup(ipAddress);                           
                        if (ipLookup != null && ipLookup.country != null)
                            obj.Country = ipLookup.country.iso_code;
                        else
                            obj.Country = "Unknown";
                        obj.msgSize = lineParts[3];
                        obj.sender = lineParts[6];
                        obj.recipient = lineParts[7].split('@')[0];
                        obj.subject = lineParts[8];
                        obj.msgTime = lineParts[9];
                        obj.spamResult = lineParts[10];
                        obj.spamInfo = lineParts[11].replace("Message ", "");
                        obj.spamScore = lineParts[12];                        
                        obj.ipLookup = "https://www.ipqualityscore.com/ip-reputation-check/lookup/" + ipAddress;                        
                        logList.push(obj);
                    }
                }
            }

            //Only process the most recent file
            if (req.query.today)
                break;
        }
        
        //Tracking timing.. File Count per file timing 
        let endTime = performance.now()    
        let totalTime = endTime - startTime;
        let now = new Date().toLocaleString();   
        let results = `SPAM Log Analyzer: Call to lookup ${logList.length.toLocaleString("en-US")} IP Addresses took ${totalTime} milliseconds `;
        tools.logData(results, "INFO");
        
        let title = "EMail Analyzer";
        res.render('MailLog', { title, logData: logList, currentTime: now});
    });  
}); 

module.exports = router;