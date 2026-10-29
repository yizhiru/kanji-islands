import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(
  process.env.PYTHON || 'python3',
  [path.join(root, 'scripts/build_standard_dictionary.py')],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
const source = JSON.parse(
  await readFile(path.join(root, 'data/vocabulary/vocabulary.json'), 'utf8'),
);
const raw = await readFile(path.join(root, 'data/vocabulary/standard.json'));
const dataset = JSON.parse(raw);
const out = path.join(root, 'public');
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'vocabulary.json'), raw);
const notice = await readFile(path.join(root, 'data/jitendex-zh/NOTICE.md'), 'utf8');
const license = await readFile(path.join(root, 'data/jitendex-zh/LICENSE'), 'utf8');
await writeFile(
  path.join(out, 'dictionary-notices.txt'),
  [
    '汉字岛 / Kanji Islands — Dictionary attribution',
    'Dictionary-derived content: CC BY-SA 4.0. Application code: MIT.',
    'Chinese: greyindex / jitendex-yomitan-zh (unofficial Chinese edition).',
    'English: Stephen Kraus / Jitendex. Japanese dictionary: EDRDG / JMdict.',
    'Source: https://github.com/greyindex/jitendex-yomitan-zh/releases/tag/v2026.08.11-zh.4',
    'Source: https://github.com/stephenmk/stephenmk.github.io/releases/tag/2026.08.11.0',
    ...Object.entries(source.metadata.resources)
      .filter(([, value]) => value.attribution)
      .map(([key, value]) => `${key}: ${value.attribution}`),
    '\nUPSTREAM NOTICE\n',
    notice,
    '\nUPSTREAM LICENSE\n',
    license,
  ].join('\n\n'),
);
// Browser preview can also inspect the exact source pages; production ships these locally.
await mkdir(path.join(out, 'sources'), { recursive: true });
await Promise.all(
  [
    ['初级词汇表_完整校对文字版.pdf', 'beginner.pdf'],
    ['中级词汇表_完整校对文字版.pdf', 'intermediate.pdf'],
  ].map(([from, to]) => copyFile(path.join(root, from), path.join(out, 'sources', to))),
);
console.log(
  `Prepared ${dataset.metadata.entryCount.toLocaleString()} dictionary entries (${(raw.length / 1e6).toFixed(1)} MB), including verified textbook tags.`,
);
