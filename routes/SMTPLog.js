const express = require('express');
const router = express.Router();
const path = require('path');
const tools = require("../app/tools");
const fs = require("fs");
const xss = require("xss");
const moment = require("moment");
const Set = require("collections/set");
const MMDBReader = require('mmdb-reader');
const mmdb = new MMDBReader(path.join(__dirname, '../GeoLite2-Country.mmdb'));
const config = require('../config');

/* Display Main page */
router.get('/', function(req, res) {

    const logPath = config.SMTP_LOG_DIR;    
    const fileTypes = ".log";  

    tools.getSortedFiles(logPath, fileTypes, "ByLastUpdateDesc", function (err, files) {
        //Process each log file
        let logData = [];
        let startTime = performance.now();
        for (let i=0; i<files.length; i++) 
        {
            let obj;
            let filePath = logPath + "\\" + files[i].name;
            if (filePath.includes("SMTP-Activity"))
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
                        let lineParts = line.split(' ');
                        if (lineParts.length < 10)
                            continue;            
                        
                        //Only analyzing inbound attempts
                        let agent = lineParts[3];                
                        if (agent != "SMTP-IN") 
                            continue;
                        
                        //Skip internal addresses..
                        let ipAddress = lineParts[2];                        
                        if (ipAddress.startsWith("10.1.10.") || ipAddress.startsWith("192.168.") || ipAddress=="127.0.0.1") 
                            continue;
                                                
                        let dateTime = moment(lineParts[0] + " " + lineParts[1]).valueOf();
                        let date = moment(lineParts[0]).valueOf();
                        
                        let method = lineParts[7];
                        let system = lineParts[8];
                        let query = lineParts[9];
                        let username = lineParts[13];                       

                        //Only trakcing authentication issues
                        if ((method != "AUTH") && (method != "MAIL") && (method != "RCPT")) 
                            continue;
                        
                        //Skip normal email receipt
                        if (method == "MAIL" && query.includes("Requested+mail+action+okay")) 
                            continue;
                        
                        if (method == "MAIL")
                        {
                            try {
                                let semi_location = system.indexOf(";");
                                let end_mark = system.indexOf("&", semi_location);
                                if (semi_location > 0 && end_mark > 1)
                                    username = system.substring(semi_location + 1, (end_mark));                                    
                            }
                            catch (err)
                            {
                                tools.logData(`Error trying to extract email address. Error: ${err}`, "ERROR");
                            }
                        }
                        username = username.trim();
                        let ipGroup;    
                        let groupBy = (req.query.groupBy == undefined) ? "" : req.query.groupBy;
                        let pieces = ipAddress.split(".");
                        switch (groupBy)
                        {
                            case "/24":
                                ipGroup = pieces[0] + "." + pieces[1] + "." + pieces[2] + ".0";
                                break;
                            case "/16":
                                ipGroup = pieces[0] + "." + pieces[1] + ".0.0";
                                break;
                            case "/8":
                                ipGroup = pieces[0] + ".0.0.0";
                                break;
                            default:
                                ipGroup = ipAddress;
                                groupBy = "";
                                break;
                        }                        
                        obj = logData[ipGroup];
                        if (obj == null)
                        {
                            obj = {};                            
                            obj.ipAddress = ipGroup + groupBy;                            
                            let ipLookup = mmdb.lookup(ipAddress);                           
                            if (ipLookup != null && ipLookup.country != null)
                                obj.Country = ipLookup.country.names.en;
                            else
                                obj.Country = "Unknown";
                            obj.BlockedIP = false;
                            obj.Attempts = 0;
                            obj.Failures = 0;
                            obj.Success = 0;
                            obj.DaysSeen = 1;
                            obj.FailedSend = 0;
                            obj.Days = [];
                            obj.Days.push(date);
                            obj.UniqueIPs = [];
                            obj.UniqueIPs.push(ipAddress);
                            obj.UniqueIPCount = 1;
                            obj.FirstSeen = dateTime;
                            obj.LastSeen = dateTime;
                            obj.ipLookup = "https://www.ipqualityscore.com/ip-reputation-check/lookup/" + ipAddress;
                            obj.Users = new Set();
                            if (username != "-") {
                                 obj.Users.add(username);
                                 obj.UserDisplay = username;
                            }
                            else
                                obj.UserDisplay = "";
                        }                        
                        obj.Command = method;
                        if (obj.Days.includes(date) == false)
                        {
                            obj.DaysSeen++;     
                            obj.Days.push(date);                   
                        }
                        if (obj.UniqueIPs.includes(ipAddress) == false)
                        {
                            obj.UniqueIPCount++;
                            obj.UniqueIPs.push(ipAddress);
                        }
                        if (obj.FirstSeen > dateTime)
                            obj.FirstSeen = dateTime;
                        if (obj.LastSeen < dateTime)
                            obj.LastSeen = dateTime;
                        
                        if ((username != "-") && (obj.Users.has(username) == false))
                        {
                            //Only track upto 10
                            if (obj.Users.length == 0)
                                obj.UserDisplay = username;
                            else if (obj.Users.length < 10)
                                obj.UserDisplay += ", " + username;                            

                            obj.Users.add(username);
                        }
                        
                        //Track attempts, failures and success
                        if (system.includes("AUTH+LOGIN"))
                            obj.Attempts++;
                        if (query.includes("Invalid+Username+or+Password"))
                            obj.Failures++;
                        if (query.includes("Requested+action+not+taken"))
                            obj.Failures++;                        
                        if (query.includes("Authenticated"))
                        {
                            obj.ipLookup = "https://ip-api.com/#" + obj.ipAddress;
                            obj.Success++;
                        }
                        if (query.includes("This+mail+server+requires+authentication+before+sending+mail+from+a+locally+hosted+domain"))
                            obj.FailedSend++;
                        if (query.includes("Sender+domain+is+invalid"))
                            obj.FailedSend++;
                                     
                        logData[ipGroup] = obj;                            
                    }
                }
            }

            //Only process the most recent file
            if (req.query.today)
                break;
        }
        let logList = [];
        for(var key in logData)
        {
            let item = logData[key];
            if (req.query.today)
            {
                item.FirstSeen = moment(item.FirstSeen).format('HH:mm:ss');
                item.LastSeen = moment(item.LastSeen).format('HH:mm:ss');
            }
            else {
                item.FirstSeen = moment(item.FirstSeen).format('MM/DD/YYYY');
                item.LastSeen = moment(item.LastSeen).format('MM/DD/YYYY');
            }
            item.UserDisplay += " (" +  item.Users.size + ")";
            item.UserCount = item.Users.size;
            logList.push(item);
        }
        
        //Tracking timing.. File Count per file timing 
        let endTime = performance.now()    
        let totalTime = endTime - startTime;
        let results = `SMTP Log Analyzer: Call to lookup ${logList.length.toLocaleString("en-US")} IP Addresses took ${totalTime} milliseconds `;
        tools.logData(results, "INFO");
        
        let title = "SMTPLog Analyzer";
        let todayViewAllParams = new URLSearchParams(req.query);
        todayViewAllParams.delete('today');
        let todayViewAllUrl = req.baseUrl + req.path + (todayViewAllParams.toString() ? '?' + todayViewAllParams.toString() : '');
        res.render('SMTPLogGrid', { title, logData: logList, today: !!req.query.today, todayViewAllUrl });
    });  
}); 

module.exports = router;