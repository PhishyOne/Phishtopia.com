import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const COMMIT = '0b97b1240db2895b447af4735d3dc95d633c3391';
const URL = `https://api.github.com/repos/PhishyOne/Phishtopia.com/tarball/${COMMIT}`;

test('report the exact GitHub archive digest required by the controlled deployment worker', async () => {
  const response = await fetch(URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'phishtopia-ops-worker/1',
    },
    redirect: 'follow',
  });

  assert.equal(response.ok, true, `GitHub archive request failed with ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 0, 'GitHub archive was empty');

  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.match(digest, /^[0-9a-f]{64}$/);
  console.log(`PHISHTOPIA_ARCHIVE_SHA256=${digest}`);
});
