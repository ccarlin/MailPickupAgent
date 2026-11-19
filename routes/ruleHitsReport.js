const express = require('express');
const { getAllHitsArray, deleteHit, clearAllHits } = require('../app/ruleHits');

const router = express.Router();

function parseFilterValue(ruleValue) {
  try {
    return typeof ruleValue === 'string' ? JSON.parse(ruleValue) : ruleValue;
  } catch {
    return null;
  }
}

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
    const obj = parseFilterValue(ruleValue);
    if (!obj) return ruleValue;
    const parts = [];
    if (obj.recipient) parts.push('rcpt:' + obj.recipient);
    if (obj.sender) parts.push('from:' + obj.sender);
    if (obj.ipAddress) parts.push('ip:' + obj.ipAddress);
    return parts.join(' ') || ruleValue;
  }
  if (subType === 'keywordFilters') {
    const obj = parseFilterValue(ruleValue);
    if (!obj) return ruleValue;
    const name = obj.FilterName || '';
    const expr = obj.FilterExpression || '';
    const short = expr.length > 50 ? expr.substring(0, 50) + '...' : expr;
    return name ? name + ' (' + short + ')' : short;
  }
  return ruleValue;
}

function resolveName(ruleType, ruleValue) {
  const subType = ruleType.split('.').pop();
  if (subType === 'keywordFilters') {
    const obj = parseFilterValue(ruleValue);
    const name = obj && obj.FilterName ? String(obj.FilterName) : '';
    return name || String(ruleValue);
  }
  return resolveDisplayLabel(ruleType, ruleValue);
}

function resolveAggregatedLabel(ruleType, ruleValue, name) {
  const subType = ruleType.split('.').pop();
  if (subType === 'keywordFilters') {
    const obj = parseFilterValue(ruleValue);
    if (obj && obj.FilterName) return name;
    return resolveDisplayLabel(ruleType, ruleValue);
  }
  return name;
}

function resolveScore(ruleType, ruleValue) {
  const subType = ruleType.split('.').pop();
  if (subType === 'keywordFilters') {
    const obj = parseFilterValue(ruleValue);
    return obj && obj.Score ? String(obj.Score) : '';
  }
  if (subType === 'senders' || subType === 'ipRanges') {
    const major = ruleType.split('.')[0];
    return major === 'whitelist' ? 'WL' : 'BL';
  }
  return '';
}

function compareScores(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = a !== '' && Number.isFinite(aNum);
  const bIsNum = b !== '' && Number.isFinite(bNum);
  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b);
}

function aggregateHits(rawHits) {
  const groups = new Map();

  rawHits.forEach(row => {
    const name = resolveName(row.rule_type, row.rule_value);
    const key = row.rule_type + '\u0000' + name;
    let group = groups.get(key);
    if (!group) {
      group = {
        rule_type: row.rule_type,
        name: name,
        display_label: resolveAggregatedLabel(row.rule_type, row.rule_value, name),
        scores: new Set(),
        hit_count: 0,
        updated_at: row.updated_at,
        entries: []
      };
      groups.set(key, group);
    }
    group.hit_count += row.hit_count;
    const score = resolveScore(row.rule_type, row.rule_value);
    if (score) group.scores.add(score);
    if (row.updated_at > group.updated_at) group.updated_at = row.updated_at;
    group.entries.push({ rule_type: row.rule_type, rule_value: row.rule_value });
  });

  return Array.from(groups.values()).map(group => ({
    rule_type: group.rule_type,
    name: group.name,
    display_label: group.display_label,
    scores: Array.from(group.scores).sort(compareScores),
    hit_count: group.hit_count,
    updated_at: group.updated_at,
    entries: group.entries
  }));
}

router.get('/', (req, res) => {
  res.render('ruleHitsReport', { title: 'Rule Hits Report' });
});

router.get('/api/rule-hits', (req, res) => {
  res.json(aggregateHits(getAllHitsArray()));
});

router.delete('/api/rule-hits/clear', (req, res) => {
  const removed = clearAllHits();
  res.json({ success: true, removed });
});

router.delete('/api/rule-hits/:ruleType/:ruleValue', (req, res) => {
  const ruleType = decodeURIComponent(req.params.ruleType);
  const ruleValue = decodeURIComponent(req.params.ruleValue);
  const removed = deleteHit(ruleType, ruleValue);
  res.json({ success: removed > 0, removed });
});

module.exports = router;
module.exports.aggregateHits = aggregateHits;
