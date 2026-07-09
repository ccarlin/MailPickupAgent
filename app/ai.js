const fs = require('fs');
const path = require('path');
const axios = require('axios');
const tools = require('./tools');
const config = require('../config');

const OLLAMA_HOST = config.OLLAMA_SERVER;
const OLLAMA_PORT = config.OLLAMA_PORT;
const OLLAMA_MODEL = config.OLLAMA_MODEL;
const OLLAMA_TIMEOUT = (config.OLLAMA_TIMEOUT || 5) * 1000;
const aiSpamPoints = Number(config.AI_SPAM_POINTS || 5) || 5;
const aiHamPoints = Number((config.AI_HAM_POINTS || 2.5) * -1) || -2.5;

async function queryOllama(prompt) {
  const url = `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`;
  const payload = {
    model: OLLAMA_MODEL,
    prompt: prompt,
    stream: false,
  };
  const resp = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: OLLAMA_TIMEOUT,
  });
  if (resp && resp.data) {
    tools.logData(`Ollama response: ${resp.data.response}`);
    return resp.data.response || '';
  }
  return '';
}

async function checkAiSpam(fromAddr, subjectText, parsed) {
  let aiSpamResult = false;
  let aiReasons = '';
  let aiScore = 0;
  let aiResponse;
  try {
    const promptPath = path.join(__dirname, '..', 'config', 'aiSpamCheckPrompt.md');
    let promptTemplate = fs.readFileSync(promptPath, 'utf8');
    const emailContent = `From: ${fromAddr}\nSubject: ${subjectText}\nBody: ${(parsed.text || '').slice(0, 2000)}`;
    const aiPrompt = promptTemplate + emailContent;
    aiResponse = await queryOllama(aiPrompt);
    aiResponse = aiResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    aiResponse = aiResponse.replace(/[\r\n]+/g, ' ');
    let parsedJson;
    try {
      parsedJson = JSON.parse(aiResponse);
    } catch {
      const openB = (aiResponse.match(/\{/g) || []).length;
      const closeB = (aiResponse.match(/\}/g) || []).length;
      const openBr = (aiResponse.match(/\[/g) || []).length;
      const closeBr = (aiResponse.match(/\]/g) || []).length;
      let fixed = aiResponse;
      for (let i = openBr - closeBr; i > 0; i--) fixed += ']';
      for (let i = openB - closeB; i > 0; i--) fixed += '}';
      try {
        parsedJson = JSON.parse(fixed);
      } catch {
        throw new SyntaxError(`Unable to parse AI response as JSON: ${aiResponse.substring(0, 100)}`);
      }
    }
    const classification = (parsedJson.classification || '').toUpperCase();
    const confidence = parseFloat(parsedJson.confidence_score) || 0;
    const reasons = parsedJson.reasons || [];
    if (classification === 'SPAM') {
      aiScore = Math.round(aiSpamPoints * confidence * 10) / 10;
      aiReasons = `AI Check(${aiScore}) - ${reasons.join('; ')}`;
      aiSpamResult = true;
    } else if (classification === 'HAM') {
      aiScore = Math.round(aiHamPoints * confidence * 10) / 10;
      aiSpamResult = false;
    }
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      tools.logWarn(`Ollama request timed out after ${OLLAMA_TIMEOUT / 1000}s, not assigning score for AI check`);
    } else if (aiResponse) {
      tools.logError(`Ollama query failed, response returned: ${aiResponse}, not assigning score for AI check: ${err.message}`);
    } else {
      tools.logError(`Ollama query failed, not assigning score for AI check: ${err.message}`);
    }
  }

  return { aiSpamResult, aiScore, aiReasons };
}

module.exports = { checkAiSpam };
