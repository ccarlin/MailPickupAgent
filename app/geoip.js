'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const tar = require('tar');
const MMDBReader = require('mmdb-reader');
const config = require('../config');
const tools = require('./tools');

const DOWNLOAD_BASE_URL = 'https://download.maxmind.com';
const DEFAULT_INTERVAL_HOURS = 168;

const DB_PATH = path.join(__dirname, '..', 'GeoLite2-Country.mmdb');
const UPDATE_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function buildDownloadUrl(editionId = 'GeoLite2-Country', baseUrl = DOWNLOAD_BASE_URL) {
  const edition = String(editionId || 'GeoLite2-Country').trim();
  return `${baseUrl}/geoip/databases/${encodeURIComponent(edition)}/download?suffix=tar.gz`;
}

function resolveUpdateOptions(cfg = {}) {
  const accountId = String(cfg.MAXMIND_ACCOUNT_ID ?? '').trim();
  const licenseKey = String(cfg.MAXMIND_KEY ?? '').trim();
  if (!accountId || !licenseKey) return null;

  const editionId = String(cfg.MAXMIND_EDITION_ID || 'GeoLite2-Country').trim();
  const rawHours = Number(cfg.MAXMIND_UPDATE_INTERVAL_HOURS);
  const intervalHours = Number.isFinite(rawHours) && rawHours > 0
    ? rawHours
    : DEFAULT_INTERVAL_HOURS;

  return { accountId, licenseKey, editionId, intervalHours };
}

function utcDayStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseRemoteBuildDate(headers = {}) {
  const disposition = headers['content-disposition'] || headers['Content-Disposition'];
  if (disposition) {
    const match = String(disposition).match(/(?:^|[_-])(\d{8})(?:[._]|$)/);
    if (match) {
      const raw = match[1];
      const year = Number(raw.slice(0, 4));
      const month = Number(raw.slice(4, 6));
      const day = Number(raw.slice(6, 8));
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return Date.UTC(year, month - 1, day);
      }
    }
  }

  const lastModified = headers['last-modified'] || headers['Last-Modified'];
  if (lastModified) {
    return utcDayStart(lastModified);
  }

  return null;
}

function isRemoteNewer(remoteDay, localDay) {
  if (remoteDay == null || localDay == null) return true;
  return remoteDay > localDay;
}

function formatDay(day) {
  return day == null ? 'unknown' : new Date(day).toISOString().slice(0, 10);
}

function localBuildDay(reader) {
  const epoch = Number(reader?.metadata?.build_epoch);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return utcDayStart(new Date(epoch * 1000));
}

function getUserAgent() {
  try {
    return `MailPickupAgent/${require('../package.json').version}`;
  } catch {
    return 'MailPickupAgent';
  }
}

async function findDatabaseFile(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDatabaseFile(fullPath);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mmdb')) {
      return fullPath;
    }
  }
  return null;
}

async function replaceFile(source, target) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.promises.rename(source, target);
      return;
    } catch (err) {
      lastError = err;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

function createGeoIpService(options = {}) {
  const dbPath = options.dbPath || DB_PATH;
  const http = options.http || axios;
  const logger = options.logger || tools;
  const cfg = options.cfg || config;

  let reader = loadReader();
  let checking = false;

  function loadReader() {
    try {
      const next = new MMDBReader(dbPath);
      if (localBuildDay(next) == null) {
        throw new Error('database metadata is missing build_epoch');
      }
      return next;
    } catch (err) {
      logger.logError(`GeoIP database could not be loaded from ${dbPath}: ${err.message}`);
      return null;
    }
  }

  function lookup(ip) {
    if (!reader || !ip) return null;
    try {
      return reader.lookup(ip);
    } catch (err) {
      logger.logError(`GeoIP lookup failed for IP ${ip}: ${err.message}`);
      return null;
    }
  }

  function getBuildDate() {
    const day = localBuildDay(reader);
    return day == null ? null : new Date(day);
  }

  async function checkForUpdate() {
    const opts = resolveUpdateOptions(cfg);
    if (!opts) {
      return { updated: false, reason: 'disabled' };
    }
    if (checking) {
      return { updated: false, reason: 'in-progress' };
    }

    checking = true;
    try {
      const url = buildDownloadUrl(opts.editionId);
      const requestConfig = {
        auth: { username: opts.accountId, password: opts.licenseKey },
        timeout: UPDATE_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 300,
        headers: { 'User-Agent': getUserAgent() },
      };

      const headResponse = await http.head(url, requestConfig);
      const remoteDay = parseRemoteBuildDate(headResponse.headers || {});
      const localDay = localBuildDay(reader);

      if (!isRemoteNewer(remoteDay, localDay)) {
        logger.logData(
          `GeoIP database is up to date (local build ${formatDay(localDay)}, remote build ${formatDay(remoteDay)}).`
        );
        return { updated: false, reason: 'up-to-date', remoteDay, localDay };
      }

      logger.logData(
        `GeoIP update available (local build ${formatDay(localDay)}, remote build ${formatDay(remoteDay)}). Downloading...`
      );

      const getResponse = await http.get(url, {
        ...requestConfig,
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT_MS,
        maxContentLength: MAX_DOWNLOAD_BYTES,
        maxBodyLength: MAX_DOWNLOAD_BYTES,
      });
      const archive = Buffer.from(getResponse.data || []);
      if (archive.length === 0) {
        throw new Error('downloaded archive is empty');
      }

      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mpa-geoip-'));
      const tempTarget = `${dbPath}.tmp-${process.pid}`;
      try {
        const archivePath = path.join(tempDir, 'database.tar.gz');
        const extractDir = path.join(tempDir, 'extract');
        await fs.promises.writeFile(archivePath, archive);
        await fs.promises.mkdir(extractDir);
        await tar.x({ file: archivePath, cwd: extractDir });

        const extracted = await findDatabaseFile(extractDir);
        if (!extracted) {
          throw new Error('no .mmdb file found in the downloaded archive');
        }

        await fs.promises.copyFile(extracted, tempTarget);
        const candidate = new MMDBReader(tempTarget);
        if (localBuildDay(candidate) == null) {
          throw new Error('downloaded database has invalid metadata');
        }

        await replaceFile(tempTarget, dbPath);
        reader = new MMDBReader(dbPath);

        const installedDay = localBuildDay(reader);
        logger.logData(`GeoIP database updated to build ${formatDay(installedDay)}.`);
        return { updated: true, reason: 'updated', remoteDay, localDay, buildDay: installedDay };
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        await fs.promises.rm(tempTarget, { force: true }).catch(() => {});
      }
    } catch (err) {
      const detail = err.response?.status ? `HTTP ${err.response.status}` : err.message;
      logger.logError(`GeoIP update failed: ${detail}`);
      return { updated: false, reason: 'error', error: detail };
    } finally {
      checking = false;
    }
  }

  return { lookup, getBuildDate, checkForUpdate };
}

const singleton = createGeoIpService();

module.exports = {
  ...singleton,
  createGeoIpService,
  buildDownloadUrl,
  resolveUpdateOptions,
  parseRemoteBuildDate,
  isRemoteNewer,
};
