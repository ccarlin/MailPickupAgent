const express = require('express');
const router = express.Router();
const fs = require("fs");
const path = require("path");
const config = require('../config');

router.get('/', function(req, res) {
    getDeletedEmails(function(err, emails) {
        let title = "Deleted Messages";
        res.render('deleted', { title, emails, currentTime: new Date().toLocaleString() });
    });
});

router.post('/', function(req, res) {
    let bodyPostBack = req.body;
    let action = bodyPostBack.action.toLowerCase().split(" ")[0];

    let data = Object.entries(bodyPostBack);
    let emails = [];
    for(let i=1;i<data.length;i++) {
        if (data[i][1] == "on") {
            let email = {};
            email.filepath = data[i][0];
            email.subject = data[i+1][1];
            email.sender = data[i+2][1];
            email.recipients = data[i+3][1];
            email.spamScore = data[i+4][1];
            email.antiSpam = data[i+5][1];
            emails.push(email);
            i = i + 5;
        } else {
            i = i + 5;
        }
    }

    if (action === "recover") {
        RecoverMessages(emails);
    }

    res.redirect(req.get('Referrer') || '/');
});

function getDeletedEmails(callback) {
    var emailList = [];
    var deletedPath = config.DELETED_DIR;

    if (!fs.existsSync(deletedPath)) {
        callback(null, emailList);
        return;
    }

    fs.readdir(deletedPath, function(err, list) {
        if (err == null) {
            for(var i=0; i<list.length; i++) {
                if(path.extname(list[i]).toLowerCase() === ".h00") {
                    let emailInfo = {};
                    let filePath = path.join(deletedPath, list[i]);
                    let emailFilePath = filePath.toLowerCase().replace(".h00", ".mai");

                    try {
                        let headerContents = fs.readFileSync(filePath).toString();
                        let lines = headerContents.split('\r\n');
                        emailInfo.filepath = list[i].slice(0, -4);
                        emailInfo.subject = "";
                        emailInfo.spamScore = "N/A";
                        emailInfo.antiSpam = "N/A";

                        for(var j=0;j<lines.length;j++) {
                            let data = lines[j].split(/=(.+)/);
                            let key = data[0];
                            let value = data[1];
                            switch(key) {
                                case "Recipients":
                                    emailInfo.recipients = value;
                                    break;
                                case "Subject":
                                    emailInfo.subject = value;
                                    break;
                                case "Sender":
                                    emailInfo.sender = value;
                                    break;
                            }
                        }

                        if (fs.existsSync(emailFilePath)) {
                            let emailContents = fs.readFileSync(emailFilePath).toString();
                            let emailLines = emailContents.split('\r\n');
                            for(j=0;j<emailLines.length;j++) {
                                if (emailLines[j].startsWith("X-MPA")) {
                                    let parts = emailLines[j].split(": ");
                                    let key = parts[0].substring(6);
                                    let value = parts[1];
                                    switch(key) {
                                        case "SpamScore":
                                            emailInfo.spamScore = value;
                                            break;
                                        case "AntiSpam":
                                            emailInfo.antiSpam = value;
                                            break;
                                    }
                                }
                            }
                        }

                        emailList.push(emailInfo);
                    } catch(err) {
                        // skip unreadable files
                    }
                }
            }
        }
        callback(err, emailList);
    });
}

function RecoverMessages(emails) {
    let deletedPath = config.DELETED_DIR;

    for (let i=0;i<emails.length;i++) {
        let email = emails[i];
        let headerFile = path.join(deletedPath, email.filepath + ".H00");
        let emailFile = path.join(deletedPath, email.filepath + ".MAI");

        try {
            let commandText = fs.readFileSync(headerFile).toString();
            commandText = commandText.replace("Status=Delivering", "Status=UnDelivered");
            fs.writeFileSync(headerFile, commandText);

            let newEmailFile = path.join(config.SMTP_QUEUE_DIR, email.filepath + ".MAI");
            let commandFile = path.join(config.SMTP_COMMAND_DIR, email.filepath + ".H00");

            fs.renameSync(emailFile, newEmailFile);
            fs.renameSync(headerFile, commandFile);
        } catch(err) {
            console.error(`Unable to recover email ${email.filepath}. Error: ${err}`);
        }
    }
}

module.exports = router;
