import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = await readFile(path.join(root, 'data/vocabulary/vocabulary.json'));
const source = JSON.parse(raw);
const entries = source.entries.map((e) => ({
  id: e.id,
  word: e.word,
  reading_hiragana: e.reading_hiragana,
  jmdict_id: e.jmdict_id,
  meanings_zh: e.meanings_zh,
  meanings_en: e.meanings_en,
  senses: e.senses.map(({ id, zh, en, pos, labels, notes_zh, notes_en }) => ({
    id,
    zh,
    en,
    pos,
    labels,
    notes_zh,
    notes_en,
  })),
  references: e.references,
  sources: e.sources.map((s) => ({
    level: s.level,
    lessons: s.corrected_lessons ?? s.lessons,
    original_lessons: s.lessons,
    original_word: s.original_word,
    raw_line: s.raw_line,
    pdf_page: s.pdf_page,
    book_page: s.book_page,
    correction_note: s.correction_note,
  })),
  ...(e.inflection ? { inflection: e.inflection, meanings_scope: 'lemma' } : {}),
}));
if (
  entries.length !== source.metadata.summary.main_entries ||
  entries.some((e) => !e.id || !e.word || !e.senses.length)
) {
  throw new Error('Source vocabulary validation failed');
}
const out = path.join(root, 'public');
await mkdir(out, { recursive: true });
const dataset = {
  version: 1,
  metadata: {
    entryCount: entries.length,
    pendingGroups:
      source.metadata.summary.unmatched_groups + source.metadata.summary.ambiguous_groups,
    sourceHash: createHash('sha256').update(raw).digest('hex'),
    chineseVersion: 'Jitendex 非官方中文版 v2026.08.11-zh.4',
    englishVersion: 'Jitendex 2026.08.11.0 / JMdict',
  },
  entries,
};
await writeFile(path.join(out, 'vocabulary.json'), JSON.stringify(dataset));
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
  `Prepared ${entries.length.toLocaleString()} approved entries (${(JSON.stringify(dataset).length / 1e6).toFixed(1)} MB). No review candidates or learning records included.`,
);
