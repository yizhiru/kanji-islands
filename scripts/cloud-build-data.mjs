import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/cloud-build');
const magic = Buffer.from('KANJI-BUILD-1\n');
export const resourcePaths = [
  'public/vocabulary.json',
  'public/dictionary-notices.txt',
  'public/sources/beginner.pdf',
  'public/sources/intermediate.pdf',
];
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function decodeKey(key) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32)
    throw new Error('构建资源密钥必须是 32 字节的 Base64 值。');
  return Buffer.from(key, 'base64');
}

export async function packResources(directory, key) {
  const files = await Promise.all(
    resourcePaths.map(async (name) => {
      const bytes = await readFile(path.join(directory, name));
      return { name, sha256: digest(bytes), content: bytes.toString('base64') };
    }),
  );
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', decodeKey(key), iv);
  cipher.setAAD(magic);
  const compressed = gzipSync(JSON.stringify({ version: 1, files }));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted]);
}

export async function restoreResources(bytes, key, expectedHash, directory) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || digest(bytes) !== expectedHash)
    throw new Error('构建资源包 SHA-256 不匹配。');
  if (!bytes.subarray(0, magic.length).equals(magic)) throw new Error('不支持的构建资源包格式。');
  const offset = magic.length;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    decodeKey(key),
    bytes.subarray(offset, offset + 12),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  const compressed = Buffer.concat([
    decipher.update(bytes.subarray(offset + 28)),
    decipher.final(),
  ]);
  const bundle = JSON.parse(gunzipSync(compressed).toString('utf8'));
  if (
    bundle.version !== 1 ||
    !Array.isArray(bundle.files) ||
    bundle.files.length !== resourcePaths.length ||
    new Set(bundle.files.map((f) => f.name)).size !== resourcePaths.length
  )
    throw new Error('构建资源包清单不完整。');
  // Validate the complete allowlist and hashes before writing any file.
  const files = bundle.files.map((file) => {
    if (!resourcePaths.includes(file.name)) throw new Error('资源包包含未允许的文件路径。');
    const content = Buffer.from(file.content, 'base64');
    if (digest(content) !== file.sha256) throw new Error(`资源校验失败：${file.name}`);
    return { name: file.name, content };
  });
  const dataset = JSON.parse(files.find((f) => f.name === 'public/vocabulary.json').content);
  if (
    ![1, 2].includes(dataset.version) ||
    !Array.isArray(dataset.entries) ||
    !dataset.entries.length ||
    dataset.entries.length !== dataset.metadata?.entryCount
  )
    throw new Error('词库格式或条目数量不正确。');
  for (const file of files) {
    const destination = path.join(directory, file.name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
  // electron-builder extraResources expects the original PDF names at the root.
  await copyFile(
    path.join(directory, 'public/sources/beginner.pdf'),
    path.join(directory, '初级词汇表_完整校对文字版.pdf'),
  );
  await copyFile(
    path.join(directory, 'public/sources/intermediate.pdf'),
    path.join(directory, '中级词汇表_完整校对文字版.pdf'),
  );
  return { version: dataset.version, entries: dataset.entries.length };
}

async function prepare() {
  execFileSync(process.execPath, [path.join(root, 'scripts/prepare-app-data.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  await mkdir(output, { recursive: true, mode: 0o700 });
  // Reuse the local key so older resource bundles remain decryptable after updates.
  let key;
  try {
    key = (await readFile(path.join(output, 'build-data.key'), 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    key = randomBytes(32).toString('base64');
  }
  const bytes = await packResources(root, key);
  const sha256 = digest(bytes);
  await writeFile(path.join(output, 'build-data.key'), key + '\n', { mode: 0o600 });
  await writeFile(path.join(output, 'build-data.enc'), bytes);
  await writeFile(
    path.join(output, 'manifest.json'),
    JSON.stringify({ sha256, tag: `windows-build-data-${sha256.slice(0, 16)}` }, null, 2) + '\n',
  );
  console.log(`已生成加密资源包：output/cloud-build/build-data.enc (${bytes.length} bytes)`);
  console.log('密钥仅保存在已被 Git 忽略的 output/cloud-build/build-data.key。');
}

async function upload(repository) {
  const gh = (args, options = {}) =>
    execFileSync('gh', args, { cwd: root, encoding: 'utf8', ...options }).trim();
  repository ??= gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('仓库格式应为 OWNER/REPO。');
  const bytes = await readFile(path.join(output, 'build-data.enc'));
  const key = (await readFile(path.join(output, 'build-data.key'), 'utf8')).trim();
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (digest(bytes) !== manifest.sha256) throw new Error('资源包已变化，请重新 prepare。');
  decodeKey(key);
  // Use a draft release: neither the release nor its encrypted asset is published.
  // Resume after partial uploads without replacing assets from another snapshot.
  let release;
  try {
    release = JSON.parse(
      gh([
        'release',
        'view',
        manifest.tag,
        '--repo',
        repository,
        '--json',
        'assets,isDraft,databaseId',
      ]),
    );
  } catch {
    const notes = path.join(output, 'release-notes.txt');
    await writeFile(notes, 'Encrypted Windows build resources. Keep this release as a draft.\n');
    const defaultBranch = gh([
      'repo',
      'view',
      repository,
      '--json',
      'defaultBranchRef',
      '--jq',
      '.defaultBranchRef.name',
    ]);
    gh([
      'release',
      'create',
      manifest.tag,
      '--repo',
      repository,
      '--draft',
      '--target',
      defaultBranch,
      '--title',
      manifest.tag,
      '--notes-file',
      notes,
    ]);
    release = JSON.parse(
      gh([
        'release',
        'view',
        manifest.tag,
        '--repo',
        repository,
        '--json',
        'assets,isDraft,databaseId',
      ]),
    );
  }
  if (!release.isDraft) throw new Error('构建资源发布已被公开，请使用新的资源快照。');
  if (!release.assets.some((asset) => asset.name === 'build-data.enc')) {
    gh([
      'release',
      'upload',
      manifest.tag,
      path.join(output, 'build-data.enc'),
      '--repo',
      repository,
    ]);
    release = JSON.parse(
      gh([
        'release',
        'view',
        manifest.tag,
        '--repo',
        repository,
        '--json',
        'assets,isDraft,databaseId',
      ]),
    );
  }
  const asset = release.assets.find((item) => item.name === 'build-data.enc');
  const assetId = new URL(asset.apiUrl).pathname.split('/').pop();
  if (!/^\d+$/.test(assetId)) throw new Error('无法获取资源附件 ID。');
  // Pass the key over stdin; never place it in command arguments or logs.
  gh(['secret', 'set', 'WINDOWS_BUILD_DATA_KEY', '--repo', repository], { input: key });
  gh(['variable', 'set', 'WINDOWS_BUILD_DATA_ASSET_ID', '--repo', repository], { input: assetId });
  gh(['variable', 'set', 'WINDOWS_BUILD_DATA_SHA256', '--repo', repository], {
    input: manifest.sha256,
  });
  console.log(`已配置 ${repository} 的 Windows 构建资源（draft release ${release.databaseId}）。`);
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === 'prepare') return prepare();
  if (command === 'upload') return upload(argument);
  if (command === 'download') {
    const repository = process.env.GITHUB_REPOSITORY ?? '';
    const assetId = process.env.WINDOWS_BUILD_DATA_ASSET_ID ?? '';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^\d+$/.test(assetId))
      throw new Error('请先通过 upload 配置 WINDOWS_BUILD_DATA_ASSET_ID。');
    if (!argument) throw new Error('请提供下载目标路径。');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const bytes = execFileSync(
          'gh',
          [
            'api',
            `repos/${repository}/releases/assets/${assetId}`,
            '-H',
            'Accept: application/octet-stream',
          ],
          { maxBuffer: 256 * 1024 * 1024, timeout: 60_000 },
        );
        await writeFile(argument, bytes);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        console.warn(`资源下载失败，正在重试（${attempt}/3）。`);
      }
    }
    return;
  }
  if (command === 'restore') {
    if (!argument) throw new Error('请提供加密资源包路径。');
    const result = await restoreResources(
      await readFile(argument),
      process.env.WINDOWS_BUILD_DATA_KEY ?? '',
      process.env.WINDOWS_BUILD_DATA_SHA256 ?? '',
      root,
    );
    console.log(`已恢复 v${result.version} 词库，${result.entries} 条记录。`);
    return;
  }
  throw new Error(
    '用法：node scripts/cloud-build-data.mjs prepare | upload [OWNER/REPO] | download FILE | restore FILE',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
