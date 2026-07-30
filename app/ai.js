const fs = require('fs');
const path = require('path');
const axios = require('axios');
const tools = require('./tools');
const config = require('../config');

const OLLAMA_HOST = config.OLLAMA_SERVER;
const OLLAMA_PORT = config.OLLAMA_PORT;
const OLLAMA_MODEL = config.OLLAMA_MODEL;
const OLLAMA_TIMEOUT = (config.OLLAMA_TIMEOUT || 5) * 1000;
const LLAMACPP_SERVER = config.LLAMACPP_SERVER;
const LLAMACPP_PORT = config.LLAMACPP_PORT;
const LLAMACPP_MODEL = config.LLAMACPP_MODEL;
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

function getLlamaCppUrl() {
  const server = String(LLAMACPP_SERVER || 'localhost').replace(/\/$/, '');
  const baseUrl = /^https?:\/\//i.test(server) ? server : `http://${server}`;
  const hasPort = /:\d+(?:\/|$)/.test(baseUrl);
  const host = hasPort ? baseUrl : `${baseUrl}:${LLAMACPP_PORT || 8080}`;
  return `${host}/v1/chat/completions`;
}

async function queryLlamaCpp(prompt) {
  const payload = {
    model: LLAMACPP_MODEL,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };
  const resp = await axios.post(getLlamaCppUrl(), payload, {
    // Some llama.cpp proxy versions reset reused HTTP connections after a completion.
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    timeout: OLLAMA_TIMEOUT,
  });
  const response = resp?.data?.choices?.[0]?.message?.content || '';
  tools.logData(`llama.cpp response: ${response}`);
  return response;
}

async function queryAi(prompt) {
  const aiSystem = String(config.AI_SYSTEM || 'OLLAMA').toUpperCase();
  if (aiSystem === 'LLAMACPP') return queryLlamaCpp(prompt);
  if (aiSystem === 'OLLAMA') return queryOllama(prompt);
  throw new Error(`Unsupported AI_SYSTEM: ${config.AI_SYSTEM}`);
}

async function checkAiSpam(fromAddr, subjectText, parsed) {
  let aiSpamResult = false;
  let aiReasons = '';
  let aiScore = 0;
  let aiClassification = 'UNKNOWN';
  let aiCheckSucceeded = false;
  let aiResponse;
  try {
    const promptPath = path.resolve(__dirname, '..', config.AI_SPAM_CHECK_PROMPT_PATH || 'config/aiSpamCheckPrompt.md');
    let promptTemplate = fs.readFileSync(promptPath, 'utf8');
    const emailContent = `From: ${fromAddr}\nSubject: ${subjectText}\nBody: ${(parsed.text || '').slice(0, 2000)}`;
    const aiPrompt = promptTemplate + emailContent;
    aiResponse = await queryAi(aiPrompt);
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
    aiClassification = classification || 'UNKNOWN';
    aiCheckSucceeded = true;
    if (classification === 'SPAM') {
      aiScore = Math.round(aiSpamPoints * confidence * 10) / 10;
      aiReasons = `AI Check(${aiScore}) - ${reasons.join('; ')}`;
      aiSpamResult = true;
    } else if (classification === 'HAM') {
      aiScore = Math.round(aiHamPoints * confidence * 10) / 10;
      aiSpamResult = false;
    }
  } catch (err) {
    const aiSystem = String(config.AI_SYSTEM || 'OLLAMA');
    const errorMessage = err.response?.data?.error?.message || err.message;
    if (err.code === 'ECONNABORTED') {
      tools.logWarn(`${aiSystem} request timed out after ${OLLAMA_TIMEOUT / 1000}s, not assigning score for AI check`);
    } else if (aiResponse) {
      tools.logError(`${aiSystem} query failed, response returned: ${aiResponse}, not assigning score for AI check: ${errorMessage}`);
    } else {
      tools.logError(`${aiSystem} query failed, not assigning score for AI check: ${errorMessage}`);
    }
  }

  return { aiSpamResult, aiScore, aiReasons, aiClassification, aiCheckSucceeded };
}

module.exports = { checkAiSpam };
