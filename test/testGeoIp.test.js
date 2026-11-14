'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDownloadUrl,
  resolveUpdateOptions,
  parseRemoteBuildDate,
  isRemoteNewer,
} = require('../app/geoip');

test('buildDownloadUrl builds the MaxMind permalink', () => {
  assert.equal(
    buildDownloadUrl('GeoLite2-Country'),
    'https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz'
  );
});

test('buildDownloadUrl encodes the edition id', () => {
  assert.equal(
    buildDownloadUrl('Geo Lite/2'),
    'https://download.maxmind.com/geoip/databases/Geo%20Lite%2F2/download?suffix=tar.gz'
  );
});

test('resolveUpdateOptions is disabled without both credentials', () => {
  assert.equal(resolveUpdateOptions({ MAXMIND_ACCOUNT_ID: '123' }), null);
  assert.equal(resolveUpdateOptions({ MAXMIND_KEY: 'license' }), null);
  assert.equal(resolveUpdateOptions({}), null);
});

test('resolveUpdateOptions defaults the interval to 168 hours', () => {
  const options = resolveUpdateOptions({
    MAXMIND_ACCOUNT_ID: '123',
    MAXMIND_KEY: 'license',
  });

  assert.deepEqual(options, {
    accountId: '123',
    licenseKey: 'license',
    editionId: 'GeoLite2-Country',
    intervalHours: 168,
  });
});

test('resolveUpdateOptions honors valid values and falls back for invalid values', () => {
  const base = {
    MAXMIND_ACCOUNT_ID: '123',
    MAXMIND_KEY: 'license',
    MAXMIND_EDITION_ID: 'GeoLite2-City',
    MAXMIND_UPDATE_INTERVAL_HOURS: '24',
  };

  assert.equal(resolveUpdateOptions(base).intervalHours, 24);
  assert.equal(resolveUpdateOptions(base).editionId, 'GeoLite2-City');
  assert.equal(resolveUpdateOptions({ ...base, MAXMIND_UPDATE_INTERVAL_HOURS: '0' }).intervalHours, 168);
  assert.equal(resolveUpdateOptions({ ...base, MAXMIND_UPDATE_INTERVAL_HOURS: 'abc' }).intervalHours, 168);
});

test('parseRemoteBuildDate prefers the content-disposition date', () => {
  const day = parseRemoteBuildDate({
    'content-disposition': 'attachment; filename=GeoLite2-Country_20261110.tar.gz',
    'last-modified': 'Wed, 11 Nov 2026 10:00:00 GMT',
  });

  assert.equal(day, Date.UTC(2026, 10, 10));
});

test('parseRemoteBuildDate falls back to last-modified at UTC day granularity', () => {
  const day = parseRemoteBuildDate({
    'last-modified': 'Wed, 11 Nov 2026 23:59:00 GMT',
  });

  assert.equal(day, Date.UTC(2026, 10, 11));
});

test('parseRemoteBuildDate returns null when no date is present', () => {
  assert.equal(parseRemoteBuildDate({}), null);
});

test('isRemoteNewer compares UTC days and treats missing values as newer', () => {
  assert.equal(isRemoteNewer(Date.UTC(2026, 10, 11), Date.UTC(2026, 10, 10)), true);
  assert.equal(isRemoteNewer(Date.UTC(2026, 10, 10), Date.UTC(2026, 10, 11)), false);
  assert.equal(isRemoteNewer(Date.UTC(2026, 10, 10), Date.UTC(2026, 10, 10)), false);
  assert.equal(isRemoteNewer(null, Date.UTC(2026, 10, 10)), true);
  assert.equal(isRemoteNewer(Date.UTC(2026, 10, 10), null), true);
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');

const { createGeoIpService } = require('../app/geoip');

const BUNDLED_DB = path.join(__dirname, '..', 'GeoLite2-Country.mmdb');

function makeLogger() {
  const lines = [];
  return {
    lines,
    logData: message => lines.push(message),
    logWarn: message => lines.push(message),
    logError: message => lines.push(message),
  };
}

async function makeArchive(tempDir, buildDate = '20261110') {
  const sourceDir = path.join(tempDir, 'source');
  const folder = `GeoLite2-Country_${buildDate}`;
  const folderPath = path.join(sourceDir, folder);
  await fs.promises.mkdir(folderPath, { recursive: true });
  await fs.promises.copyFile(BUNDLED_DB, path.join(folderPath, 'GeoLite2-Country.mmdb'));
  const archivePath = path.join(tempDir, 'database.tar.gz');
  await tar.c({ gzip: true, file: archivePath, cwd: sourceDir }, [folder]);
  return fs.readFileSync(archivePath);
}

test('checkForUpdate is disabled without credentials', async () => {
  const geoip = createGeoIpService({
    dbPath: BUNDLED_DB,
    http: {},
    logger: makeLogger(),
    cfg: {},
  });

  const result = await geoip.checkForUpdate();

  assert.equal(result.updated, false);
  assert.equal(result.reason, 'disabled');
});

test('checkForUpdate downloads, validates, replaces, and hot-swaps the database', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mpa-geoip-test-'));
  try {
    const dbPath = path.join(tempDir, 'GeoLite2-Country.mmdb');
    await fs.promises.writeFile(dbPath, 'not a database');
    const archive = await makeArchive(tempDir);
    const calls = [];
    const http = {
      head: async (url, options) => {
        calls.push({ method: 'head', url, options });
        return {
          headers: {
            'content-disposition': 'attachment; filename=GeoLite2-Country_20261110.tar.gz',
          },
        };
      },
      get: async (url, options) => {
        calls.push({ method: 'get', url, options });
        return { data: archive };
      },
    };
    const logger = makeLogger();
    const geoip = createGeoIpService({
      dbPath,
      http,
      logger,
      cfg: { MAXMIND_ACCOUNT_ID: '123', MAXMIND_KEY: 'license' },
    });

    const result = await geoip.checkForUpdate();

    assert.equal(result.updated, true);
    assert.equal(result.reason, 'updated');
    assert.deepEqual(calls.map(call => call.method), ['head', 'get']);
    assert.equal(
      calls[0].url,
      'https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz'
    );
    assert.deepEqual(calls[0].options.auth, { username: '123', password: 'license' });
    assert.ok(geoip.getBuildDate() instanceof Date);
    const lookup = geoip.lookup('8.8.8.8');
    assert.ok(lookup && lookup.country && lookup.country.iso_code);
    assert.equal(
      fs.readdirSync(tempDir).some(name => name.startsWith('GeoLite2-Country.mmdb.tmp-')),
      false
    );
    assert.equal(logger.lines.some(line => line.includes('GeoIP database updated')), true);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});

test('checkForUpdate skips the download when the remote build date is not newer', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mpa-geoip-test-'));
  try {
    const dbPath = path.join(tempDir, 'GeoLite2-Country.mmdb');
    await fs.promises.copyFile(BUNDLED_DB, dbPath);
    const logger = makeLogger();
    const cfg = { MAXMIND_ACCOUNT_ID: '123', MAXMIND_KEY: 'license' };

    const dateService = createGeoIpService({ dbPath, http: {}, logger, cfg });
    const local = dateService.getBuildDate();
    const stamp = local.toISOString().slice(0, 10).replace(/-/g, '');

    let getCalled = false;
    const geoip = createGeoIpService({
      dbPath,
      logger,
      cfg,
      http: {
        head: async () => ({
          headers: {
            'content-disposition': `attachment; filename=GeoLite2-Country_${stamp}.tar.gz`,
          },
        }),
        get: async () => {
          getCalled = true;
          return { data: Buffer.alloc(0) };
        },
      },
    });

    const result = await geoip.checkForUpdate();

    assert.equal(result.updated, false);
    assert.equal(result.reason, 'up-to-date');
    assert.equal(getCalled, false);
    assert.equal(logger.lines.some(line => line.includes('up to date')), true);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});

test('checkForUpdate keeps the existing database and reader when the download is invalid', async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mpa-geoip-test-'));
  try {
    const dbPath = path.join(tempDir, 'GeoLite2-Country.mmdb');
    await fs.promises.copyFile(BUNDLED_DB, dbPath);
    const before = fs.readFileSync(dbPath);
    const geoip = createGeoIpService({
      dbPath,
      logger: makeLogger(),
      cfg: { MAXMIND_ACCOUNT_ID: '123', MAXMIND_KEY: 'license' },
      http: {
        head: async () => ({
          headers: {
            'content-disposition': 'attachment; filename=GeoLite2-Country_20990101.tar.gz',
          },
        }),
        get: async () => ({ data: Buffer.from('not a tar archive') }),
      },
    });

    const result = await geoip.checkForUpdate();

    assert.equal(result.updated, false);
    assert.equal(result.reason, 'error');
    assert.deepEqual(fs.readFileSync(dbPath), before);
    assert.ok(geoip.lookup('8.8.8.8'));
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
});

test('startAutoUpdate returns false and warns when credentials are missing', () => {
  const logger = makeLogger();
  const geoip = createGeoIpService({
    dbPath: BUNDLED_DB,
    http: {},
    logger,
    cfg: {},
  });

  assert.equal(geoip.startAutoUpdate(), false);
  assert.equal(
    logger.lines.some(line => line.includes('GeoIP auto-update disabled')),
    true
  );
});

test('startAutoUpdate schedules and stopAutoUpdate clears the timer', () => {
  const geoip = createGeoIpService({
    dbPath: BUNDLED_DB,
    http: {},
    logger: makeLogger(),
    cfg: { MAXMIND_ACCOUNT_ID: '123', MAXMIND_KEY: 'license' },
    initialDelayMs: 60_000,
  });

  assert.equal(geoip.startAutoUpdate(), true);
  assert.equal(geoip.startAutoUpdate(), true);
  assert.doesNotThrow(() => geoip.stopAutoUpdate());
  assert.doesNotThrow(() => geoip.stopAutoUpdate());
});
