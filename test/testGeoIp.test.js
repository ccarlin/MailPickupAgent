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
