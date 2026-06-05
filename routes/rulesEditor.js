const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

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

// Save updated rules to rules.json
router.post('/api/rules/save', (req, res) => {
  const { rules } = req.body;
  const rulesPath = path.resolve(__dirname, '../config/rules.json');
  
  // Backup the original file using timestamp to avoid overwriting previous backups
  const backupFile = `${rulesPath}_${Date.now().toString()}.bak`;
  fs.copyFileSync(rulesPath, backupFile);
  
  try {
    fs.writeFileSync(rulesPath, JSON.stringify(JSON.parse(rules), null, 2), 'utf8');
    res.status(200).json({ message: 'Rules saved successfully!' });
  } catch (error) {
    console.error('Error saving rules file:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

module.exports = router;