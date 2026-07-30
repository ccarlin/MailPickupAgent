const axios = require('axios');
const tools = require('./tools');
const config = require('../config');

const ABUSEIPDB_API_URL = 'https://api.abuseipdb.com/api/v2/check';

async function check(ip) {
  const key = config.ABUSEIPDB_KEY;
  const timeout = (config.ABUSEIPDB_TIMEOUT || 5) * 1000;

  if (!key || !ip) {
    return null;
  }

  if (tools.isPrivateIp(ip)) {
    tools.logData('AbuseIPDB check skipped: IP is private/local');
    return null;
  }

  try {
    const response = await axios.get(ABUSEIPDB_API_URL, {
      params: { ipAddress: ip },
      headers: {
        'Key': key,
        'Accept': 'application/json',
      },
      timeout: timeout,
    });

    const data = response?.data?.data;
    if (!data) {
      return null;
    }

    const abuseConfidenceScore = data.abuseConfidenceScore || 0;
    const totalReports = data.totalReports || 0;
    const countryCode = data.countryCode || '';
    const isp = data.isp || '';

    tools.logData(`AbuseIPDB result for ${ip}: confidenceScore=${abuseConfidenceScore}, totalReports=${totalReports}, country=${countryCode}, isp=${isp}`);

    return { abuseConfidenceScore, totalReports, countryCode, isp };
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      tools.logWarn(`AbuseIPDB request timed out after ${timeout / 1000}s for IP ${ip}`);
    } else {
      const errorMessage = err.response?.data?.errors?.[0]?.detail || err.message;
      tools.logError(`AbuseIPDB check failed for IP ${ip}: ${errorMessage}`);
    }
    return null;
  }
}

module.exports = { check };
