const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const tools = require('../app/tools');
const { purgeOldBackups } = require('../index');
const { getAllHits } = require('../app/ruleHits');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('rulesEditor', { title: 'Rules Editor' });
});

// Get rules.json content
router.get('/api/rules', (req, res) => {
  const rulesPath = path.resolve(__dirname, '../config/rules.json');
  try {
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');
    res.json(normalizeRules(JSON.parse(rulesContent)));
  } catch (error) {
    tools.logError('Error reading rules file: ' + error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.get('/api/rule-hits', (req, res) => {
  res.json(getAllHits());
});

function ensureRuleStructure(rulesObj) {
  if (!rulesObj || typeof rulesObj !== 'object') return rulesObj;

  if (!rulesObj.whitelist || typeof rulesObj.whitelist !== 'object') rulesObj.whitelist = {};
  if (!Array.isArray(rulesObj.whitelist.senders)) rulesObj.whitelist.senders = [];
  if (!Array.isArray(rulesObj.whitelist.ipRanges)) rulesObj.whitelist.ipRanges = [];

  if (!rulesObj.blacklist || typeof rulesObj.blacklist !== 'object') rulesObj.blacklist = {};
  if (!Array.isArray(rulesObj.blacklist.senders)) rulesObj.blacklist.senders = [];
  if (!Array.isArray(rulesObj.blacklist.ipRanges)) rulesObj.blacklist.ipRanges = [];
  if (!Array.isArray(rulesObj.blacklist.countries)) rulesObj.blacklist.countries = [];
  if (!Array.isArray(rulesObj.blacklist.combos)) rulesObj.blacklist.combos = [];
  if (!Array.isArray(rulesObj.blacklist.keywordFilters)) rulesObj.blacklist.keywordFilters = [];

  if (!Array.isArray(rulesObj.allowedTLDs)) rulesObj.allowedTLDs = [];
  return rulesObj;
}

function normalizeRules(rulesObj) {
  ensureRuleStructure(rulesObj);

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
    if (rulesObj.blacklist.keywordFilters) {
      rulesObj.blacklist.keywordFilters.forEach(item => {
        if (item.Recipient && typeof item.Recipient === 'string') {
          item.Recipient = item.Recipient.trim().toUpperCase();
        }
      });
    }
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

  // Enforce backup retention limits
  purgeOldBackups();
  
  try {
    const parsed = normalizeRules(JSON.parse(rules));
    const tmpPath = rulesPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(parsed, null, 2), 'utf8');
    fs.renameSync(tmpPath, rulesPath);
    res.status(200).json({ message: 'Rules saved successfully!' });
  } catch (error) {
    tools.logError('Error saving rules file: ' + error.message);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Generate a keyword filter via Ollama AI
router.post('/api/rules/generate-keyword-filter', async (req, res) => {
  const { description } = req.body;
  if (!description || !description.trim()) {
    return res.status(400).json({ message: 'Description is required' });
  }

  const OLLAMA_HOST = config.OLLAMA_SERVER || 'localhost';
  const OLLAMA_PORT = config.OLLAMA_PORT || 11434;
  const OLLAMA_MODEL = config.OLLAMA_MODEL || 'llama3.2';

  const systemPrompt = `You are a spam filter rule generator. Given a user description, output ONLY a valid JSON object for a keyword filter with these fields:
- FilterName: short uppercase snake_case name
- FilterExpression: regex or plain text pattern
- FilterType: "0" for regex, "1" for plain text
- SearchScope: "0" body, "1" subject, "2" full message, "3" headers
- FilterExpressionType: "0" for simple "1" for complex
- FilterMatchType: "0" for any match, "1" for start with, "2" for ends with, "3" for whole word
- FilterCaseSensitive: "0" not case sensitive or "1" is case sensitive
- Score: string number 1-10 based on severity
- Comment: short description of what this detects
- Recipient: if the rule is to apply only for a name recipient put that name here otherwise leave blank
Output ONLY the JSON object, no markdown or explanation.`;

  try {
    const url = `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`;
    const payload = {
      model: OLLAMA_MODEL,
      prompt: `${systemPrompt}\n\nUser request: ${description.trim()}`,
      stream: false,
    };
    const resp = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    let responseText = '';
    if (resp && resp.data) {
      responseText = resp.data.response || '';
    }

    // Strip markdown code fences if present
    responseText = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    const filter = JSON.parse(responseText);

    // Validate required fields
    if (!filter.FilterName || !filter.FilterExpression) {
      throw new Error('AI response missing required fields');
    }

    filter.FilterName = String(filter.FilterName).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    filter.FilterExpression = String(filter.FilterExpression).trim();
    filter.Score = String(filter.Score || '1');
    filter.FilterType = String(filter.FilterType === '1' ? '1' : '0');
    filter.SearchScope = String(['1', '2', '3', '4', '5'].includes(filter.SearchScope) ? filter.SearchScope : '1');
    filter.FilterExpressionType = '1';
    filter.FilterMatchType = '0';
    filter.FilterCaseSensitive = String(filter.FilterCaseSensitive === '1' ? '1' : '0');
    if (filter.Comment) filter.Comment = String(filter.Comment).trim();
    if (filter.Recipient && String(filter.Recipient).trim()) {
      filter.Recipient = String(filter.Recipient).trim().toLowerCase();
    } else {
      delete filter.Recipient;
    }

    res.json(filter);
  } catch (error) {
    tools.logError('Error generating filter with AI: ' + error.message);
    res.status(500).json({ message: 'AI generation failed: ' + (error.message || 'Unknown error') });
  }
});

module.exports = router;
module.exports.normalizeRules = normalizeRules;
