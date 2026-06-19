const express = require('express');
const router = express.Router();
const tools = require("../tools");
const fs = require("fs");
const config = require('../config');

/* Display Main page */
router.get('/', function(req, res) {
    const logPath = config.QUARANTINE_LOG;
    const fileTypes = ".log";
   
    tools.getSortedFiles(logPath, fileTypes, "ByLastUpdateDesc", function (err, files) {
        //Process each log file
        let logList = [];
        for (let i=0; i<files.length; i++) {
            let obj;
            let filePath = logPath + "\\" + files[i].name;
            //We only care about the quarentine file..
            if (!filePath.includes("quarantine"))
                continue;
            if (fs.existsSync(filePath)) {            
                let logText = fs.readFileSync(filePath).toString();
                let logLines = logText.split('\n');
                //Process each log line
                for(let i=0;i<logLines.length;i++) {
                    let line = logLines[i];
                    let lineParts = line.split('\t');      
                    if (lineParts.length < 9)
                        continue; //Not a valid log line, skip       
                    obj = {};                    
                    obj.dateTime = lineParts[0];   
                    obj.action = lineParts[1]; 
                    obj.subject = lineParts[2];
                    obj.sender = lineParts[3];
                    obj.recipient = lineParts[4].toLowerCase();
                    obj.spamScore = lineParts[5];
                    obj.spamResults = lineParts[6];
                    obj.dkim = lineParts[7];
                    obj.ipAddress = lineParts[8];   
                    logList.push(obj);
                }
            }

            //Only process the most recent file
            if (req.query.today)
                break;
        }
                    
        let title = "Quarantine Log";
        res.render('QuarantineLogGrid', { title, logData: logList}); 
    });
}); 

module.exports = router;