import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  digest,
  packResources,
  restoreResources,
  resourcePaths,
} from '../scripts/cloud-build-data.mjs';

test('resources round-trip with Unicode paths and reject corruption before extraction', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'kanji-cloud-'));
  try {
    const source = path.join(temporary, 'source');
    const restored = path.join(temporary, 'restored');
    const rejected = path.join(temporary, 'rejected');
    await mkdir(rejected);
    for (const name of resourcePaths) {
      const destination = path.join(source, name);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(
        destination,
        name.endsWith('.json')
          ? JSON.stringify({ version: 2, metadata: { entryCount: 1 }, entries: [{ word: '学校' }] })
          : Buffer.from(`教材与许可：${name}\0\u00ff`),
      );
    }
    const key = randomBytes(32).toString('base64');
    const bundle = await packResources(source, key);
    assert.equal(bundle.includes(Buffer.from('学校')), false);
    assert.deepEqual(await restoreResources(bundle, key, digest(bundle), restored), {
      version: 2,
      entries: 1,
    });
    for (const name of resourcePaths)
      assert.deepEqual(
        await readFile(path.join(restored, name)),
        await readFile(path.join(source, name)),
      );
    assert.deepEqual(
      await readFile(path.join(restored, '初级词汇表_完整校对文字版.pdf')),
      await readFile(path.join(source, 'public/sources/beginner.pdf')),
    );
    await assert.rejects(restoreResources(bundle, key, '0'.repeat(64), rejected), /SHA-256/);
    await assert.rejects(
      restoreResources(bundle, randomBytes(32).toString('base64'), digest(bundle), rejected),
    );
    const corrupt = Buffer.from(bundle);
    corrupt[corrupt.length - 1] ^= 1;
    // Even a matching outer hash cannot bypass authenticated encryption.
    await assert.rejects(restoreResources(corrupt, key, digest(corrupt), rejected));
    assert.deepEqual(await readdir(rejected), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
