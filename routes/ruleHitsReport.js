const express = require('express');
const { getAllHitsArray } = require('../app/ruleHits');

const router = express.Router();

function resolveDisplayLabel(ruleType, ruleValue) {
  const subType = ruleType.split('.').pop();
  if (subType === 'senders') {
    return ruleValue;
  }
  if (subType === 'ipRanges') {
    return ruleValue;
  }
  if (subType === 'countries') {
    return String(ruleValue).toUpperCase();
  }
  if (subType === 'combos') {
    try {
      const obj = typeof ruleValue === 'string' ? JSON.parse(ruleValue) : ruleValue;
      const parts = [];
      if (obj.recipient) parts.push('rcpt:' + obj.recipient);
      if (obj.sender) parts.push('from:' + obj.sender);
      if (obj.ipAddress) parts.push('ip:' + obj.ipAddress);
      return parts.join(' ') || ruleValue;
    } catch {
      return ruleValue;
    }
  }
  if (subType === 'keywordFilters') {
    try {
      const obj = typeof ruleValue === 'string' ? JSON.parse(ruleValue) : ruleValue;
      const name = obj.FilterName || '';
      const expr = obj.FilterExpression || '';
      const short = expr.length > 50 ? expr.substring(0, 50) + '...' : expr;
      return name ? name + ' (' + short + ')' : short;
    } catch {
      return ruleValue;
    }
  }
  return ruleValue;
}

function resolveScore(ruleType, ruleValue) {
  const subType = ruleType.split('.').pop();
  if (subType === 'keywordFilters') {
    try {
      const obj = typeof ruleValue === 'string' ? JSON.parse(ruleValue) : ruleValue;
      return obj.Score || '';
    } catch {
      return '';
    }
  }
  if (subType === 'senders' || subType === 'ipRanges') {
    const major = ruleType.split('.')[0];
    return major === 'whitelist' ? 'WL' : 'BL';
  }
  return '';
}

router.get('/', (req, res) => {
  res.render('ruleHitsReport', { title: 'Rule Hits Report' });
});

router.get('/api/rule-hits', (req, res) => {
  const rawHits = getAllHitsArray();

  const enriched = rawHits.map(row => {
    const display = resolveDisplayLabel(row.rule_type, row.rule_value);
    const score = resolveScore(row.rule_type, row.rule_value);
    return {
      rule_type: row.rule_type,
      rule_value: row.rule_value,
      display_label: display,
      score: score,
      hit_count: row.hit_count,
      updated_at: row.updated_at
    };
  });

  res.json(enriched);
});

module.exports = router;
