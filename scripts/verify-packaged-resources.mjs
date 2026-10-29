import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as asar from '@electron/asar';
import { digest, resourcePaths } from './cloud-build-data.mjs';

const archive = process.argv[2];
assert(archive, '请提供 app.asar 路径。');
for (const source of resourcePaths) {
  const local = await readFile(source);
  const packed = asar.extractFile(archive, source.replace(/^public\//, 'dist/'));
  assert.equal(digest(packed), digest(local), `安装包资源不匹配：${source}`);
}
for (const name of ['beginner.pdf', 'intermediate.pdf']) {
  const external = await readFile(path.join(path.dirname(archive), 'sources', name));
  const local = await readFile(path.join('public/sources', name));
  assert.equal(digest(external), digest(local), `安装包 PDF 不匹配：${name}`);
}
console.log('安装包中的词库、许可和教材 PDF 均已通过 SHA-256 校验。');
