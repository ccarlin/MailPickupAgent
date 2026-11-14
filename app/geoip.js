'use strict';

const DOWNLOAD_BASE_URL = 'https://download.maxmind.com';
const DEFAULT_INTERVAL_HOURS = 168;

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

module.exports = {
  buildDownloadUrl,
  resolveUpdateOptions,
  parseRemoteBuildDate,
  isRemoteNewer,
};
