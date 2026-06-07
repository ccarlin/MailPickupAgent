const express = require('express');
const router = express.Router();
const tools = require("../tools");
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');

/* Display Main page */
router.get('/', function(req, res) {

    if (req.query.key)
    {
        res.cookie("MailKey", req.query.key, {maxAge: 1000 * 60 * 1440 * 30});
        return res.redirect("/mailq");
    }

    //Check if this is a valid connection if not send home..
    if (tools.isValid(req) == false)
        return res.redirect("/");

    const db = new sqlite3.Database(req.app.locals.mailErrorDB);
    let spamTable = [];

    let sql = "SELECT * FROM vw_spam_ip_info";
    let parms = [];
    if (req.query.range)
    {
      sql += " WHERE timestamp like ?";
      let range = "";
      switch (req.query.range)
      {
        case "Today":
          range = moment(Date.now()).format('M/D/YYYY[%]'); 
          break;
        case "Month":
          range = moment(Date.now()).format('M/[%]/YYYY[%]');
          break;
        case "Year":
          range = moment(Date.now()).format('[%]/YYYY[%]');
          break;
      }
      parms.push(range);
    }   
    db.all(sql, parms, (err, rows) => {
        if (err) {
          throw err;
        }
        spamTable = rows;
        for(let i=0;i<spamTable.length;i++)
        {
          if (spamTable[i].from_email.startsWith("bounce"))
          {
            spamTable[i].from_email = spamTable[i].from_email.split("@")[1];
          }
        }
        res.render('mailLog', { title: "Mail Log", spamTable });
    
        // close the database connection
        db.close();           
      });
      
}); 


module.exports = router;