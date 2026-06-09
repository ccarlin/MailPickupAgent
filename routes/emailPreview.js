const express = require('express');
const router = express.Router();
const tools = require("../tools");

/* GET Thumbnail images. */
router.get('/', async function(req, res) {
    
    let mailKey = req.query.mailKey;
    let mailFile = process.env.QUARANTINE_DIR + "\\" + mailKey + ".MAI";
    let inHTML = (req.query.view && req.query.view == "HTML");
    let mailMessage = await tools.emailExtract(mailFile, inHTML);
    res.send(mailMessage);    
});

module.exports = router;