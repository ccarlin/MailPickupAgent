const fs = require("fs");
const path = require("path");
const simpleParser = require('mailparser').simpleParser;
//Supress output of this command
require('dotenv').config({ quiet: true });

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
      else if ((process.env.NODE_ENV == "development") || (level != "DEBUG"))
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
        const parsed = await simpleParser(mailMessage);
        if (inHTML) return parsed.html || "No HTML part available";
        return parsed.textAsHtml || parsed.text || "No text available";
      } catch (err) {
        this.logError(`Error parsing email file: ${mailFile}, Error: ${err}`);
        return "Error parsing email message.";
      }
    },
    sleep: function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    buildFilePaths: function(messageID, queueType) {
        const qt = (queueType || '').toString().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const envDir = (suffix) => `${qt}_${suffix}`;
        const messagePath = process.env[envDir('QUEUE_DIR')] ? path.join(process.env[envDir('QUEUE_DIR')], messageID) : messageID;
        const controlFilePath = process.env[envDir('COMMAND_DIR')] ? path.join(process.env[envDir('COMMAND_DIR')], messageID) : messageID;
        console.log(`Built file paths for messageID: ${messageID}, queueType: ${queueType}`);
        console.log(`Resolved message path: ${messagePath}`);
        console.log(`Resolved control file path: ${controlFilePath}`);
        return { messagePath, controlFilePath };
    }    
};