const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('rulesEditor', { title: 'Rules Editor' });
});

// Get rules.json content
router.get('/api/rules', (req, res) => {
  const rulesPath = path.resolve(__dirname, '../config/rules.json');
  try {
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');
    res.json(JSON.parse(rulesContent));
  } catch (error) {
    console.error('Error reading rules file:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

function normalizeRules(rulesObj) {
  function lowerStrings(arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach((item, i) => {
      if (typeof item === 'string') arr[i] = item.toLowerCase();
      else if (typeof item === 'object' && item !== null) {
        for (const key of Object.keys(item)) {
          if (typeof item[key] === 'string') item[key] = item[key].toLowerCase();
        }
      }
    });
  }
  if (rulesObj.whitelist) {
    if (rulesObj.whitelist.senders) lowerStrings(rulesObj.whitelist.senders);
    if (rulesObj.whitelist.ipRanges && Array.isArray(rulesObj.whitelist.ipRanges))
      rulesObj.whitelist.ipRanges = rulesObj.whitelist.ipRanges.map(s => s.toLowerCase());
  }
  if (rulesObj.blacklist) {
    if (rulesObj.blacklist.senders) lowerStrings(rulesObj.blacklist.senders);
    if (rulesObj.blacklist.combos) lowerStrings(rulesObj.blacklist.combos);
    if (rulesObj.blacklist.countries) lowerStrings(rulesObj.blacklist.countries);
    if (rulesObj.blacklist.ipRanges && Array.isArray(rulesObj.blacklist.ipRanges))
      rulesObj.blacklist.ipRanges = rulesObj.blacklist.ipRanges.map(s => s.toLowerCase());
  }
  if (rulesObj.allowedTLDs) lowerStrings(rulesObj.allowedTLDs);
  return rulesObj;
}

// Save updated rules to rules.json
router.post('/api/rules/save', (req, res) => {
  const { rules } = req.body;
  const rulesPath = path.resolve(__dirname, '../config/rules.json');
  
  // Backup the original file using timestamp to avoid overwriting previous backups
  const backupFile = `${rulesPath}_${Date.now().toString()}.bak`;
  fs.copyFileSync(rulesPath, backupFile);
  
  try {
    const parsed = normalizeRules(JSON.parse(rules));
    fs.writeFileSync(rulesPath, JSON.stringify(parsed, null, 2), 'utf8');
    res.status(200).json({ message: 'Rules saved successfully!' });
  } catch (error) {
    console.error('Error saving rules file:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

module.exports = router;