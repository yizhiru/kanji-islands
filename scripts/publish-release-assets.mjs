import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const runID = process.env.INSTALLER_RUN_ID;
const tag = process.env.RELEASE_TAG;
assert(/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''), 'Invalid repository');
assert(/^\d+$/.test(runID ?? ''), 'Invalid installer run ID');
assert(/^v\d+\.\d+\.\d+$/.test(tag ?? ''), 'Invalid release tag');
const version = tag.slice(1);
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 600_000 });
const api = (endpoint) => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`]));
const run = api(`actions/runs/${runID}`);
assert.equal(run.name, 'Windows installer');
assert.equal(run.head_repository.full_name, repository);
assert.equal(run.status, 'completed');
assert.equal(run.conclusion, 'success', 'Installer tests must pass before uploading');
const { databaseId } = JSON.parse(
  gh(['release', 'view', tag, '--repo', repository, '--json', 'databaseId']),
);
let release = api(`releases/${databaseId}`);
assert.equal(release.draft, true, 'Only draft releases may receive these assets');
assert.equal(release.tag_name, tag);
assert.equal(release.target_commitish, run.head_sha, 'Draft must target the tested source commit');

const directory = await mkdtemp(path.join(os.tmpdir(), 'kanji-release-'));
gh(['run', 'download', runID, '--repo', repository, '--dir', directory]);
async function filesIn(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...(await filesIn(filename)));
    else if (item.isFile()) files.push(filename);
  }
  return files;
}
const files = await filesIn(directory);
const installers = files.filter((f) => f.endsWith('.exe'));
assert.equal(installers.length, 1, 'Expected one tested Windows installer');
const installer = installers[0];
assert(path.basename(installer).includes(version), 'Installer version does not match release');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const windowsHash = hash(await readFile(installer));
const originalChecksums = (
  await readFile(path.join(path.dirname(installer), 'SHA256SUMS.txt'), 'utf8')
).replace(/^\uFEFF/, '');
assert(
  originalChecksums
    .split(/\r?\n/)
    .some((line) => line === `${windowsHash}  ${path.basename(installer)}`),
  'Windows artifact checksum does not match',
);

const windowsName = `kanji-islands-${version}-windows-x64.exe`;
const destination = path.join(directory, windowsName);
await copyFile(installer, destination);
const lines = [];
for (const extension of ['dmg', 'zip']) {
  const name = `kanji-islands-${version}-macos-arm64.${extension}`;
  const asset = release.assets.find((a) => a.name === name);
  assert(
    asset?.state === 'uploaded' && /^sha256:[a-f0-9]{64}$/.test(asset.digest),
    `Missing verified macOS asset: ${name}`,
  );
  lines.push(`${asset.digest.slice(7)}  ${name}`);
}
lines.push(`${windowsHash}  ${windowsName}`);
const checksums = path.join(directory, 'SHA256SUMS.txt');
await writeFile(checksums, lines.join('\n') + '\n');

for (const filename of [destination, checksums]) {
  const name = path.basename(filename);
  const expected = `sha256:${hash(await readFile(filename))}`;
  const existing = release.assets.find((a) => a.name === name);
  if (!existing) gh(['release', 'upload', tag, filename, '--repo', repository]);
  release = api(`releases/${databaseId}`);
  const uploaded = release.assets.find((a) => a.name === name);
  assert.equal(uploaded?.state, 'uploaded');
  assert.equal(uploaded.digest, expected, `Uploaded asset checksum differs: ${name}`);
  console.log(`Verified release asset: ${name}`);
}
console.log('All release assets are ready. The release remains a draft.');
