const express = require('express');
const router = express.Router();
const tools = require("../app/tools");
const config = require('../config');

router.get('/', async function(req, res) {
    try {
        const mailKey = req.query.mailKey;
        if (!mailKey || !/^[A-Fa-f0-9]+$/.test(mailKey)) {
            return res.status(400).send('Invalid mailKey');
        }
        const baseDir = req.query.isDeleted ? config.DELETED_DIR : config.QUARANTINE_DIR;
        const mailFile = tools.resolveWithinDir(baseDir, mailKey + '.MAI');
        const inHTML = req.query.view === 'HTML';
        const showImages = req.query.showImages === 'true';

        let mailMessage;
        if (inHTML && showImages) {
            mailMessage = await tools.emailExtractWithImages(mailFile);
        } else {
            mailMessage = await tools.emailExtract(mailFile, inHTML);
        }

        const csp = inHTML && showImages
            ? "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; sandbox allow-same-origin"
            : "default-src 'none'; style-src 'unsafe-inline'; sandbox allow-same-origin";
        res.setHeader('Content-Security-Policy', csp);
        res.send(mailMessage);
    } catch {
        res.status(400).send('Invalid request');
    }
});

module.exports = router;