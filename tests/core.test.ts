import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Dataset, Entry, Filter, Source } from '../src/core/types';
import {
  entriesFor,
  kanjiOf,
  referencesFor,
  sourceMatches,
  Vocabulary,
  wordId,
} from '../src/core/vocabulary';
import { BATCH_SIZE, expandNetwork, graphOf, MAX_WORDS, startNetwork } from '../src/core/network';

const all: Filter = { scope: 'all', lesson: '' };
const beginner: Filter = { scope: 'beginner', lesson: '' };
const source = (level: '初级' | '中级', lesson: number, symbol = ''): Source => ({
  level,
  lessons: [{ lesson, symbol }],
  original_word: '',
  raw_line: '',
  pdf_page: 1,
  book_page: 1,
});
const entry = (word: string, sources = [source('初级', 1)], reading = 'かな'): Entry => ({
  id: `${word}-${reading}`,
  word,
  reading_hiragana: reading,
  jmdict_id: 1,
  meanings_zh: ['释义'],
  meanings_en: ['meaning'],
  senses: [
    {
      id: 'sense:1',
      zh: ['释义'],
      en: ['meaning'],
      pos: ['n'],
      labels: [],
      notes_zh: [],
      notes_en: [],
    },
  ],
  sources,
  references: '',
});
const fixture = (entries: Entry[]) =>
  new Vocabulary({
    version: 1,
    metadata: {
      entryCount: entries.length,
      pendingGroups: 0,
      sourceHash: '',
      chineseVersion: '',
      englishVersion: '',
    },
    entries,
  });
const vocab = fixture([
  entry('発表', [source('中级', 7, '※')]),
  entry('発音', [source('初级', 28, '※')]),
  entry('音楽'),
  entry('表面', [source('中级', 2)]),
  entry('発展'),
  entry('学校'),
  entry('生物', [source('初级', 1)], 'なまもの'),
  entry('生物', [source('中级', 2)], 'せいぶつ'),
]);

describe('word indexing and textbook filters', () => {
  it('uses complete Unicode kanji and ignores kana, repeated characters and iteration marks', () => {
    expect(kanjiOf('時々、時に𠮷！')).toEqual(['時', '𠮷']);
    expect(kanjiOf('カタカナ')).toEqual([]);
  });
  it('groups spellings without dropping multiple readings', () => {
    expect(vocab.get(wordId('生物')).entries).toHaveLength(2);
    expect(entriesFor(vocab.get(wordId('生物')), beginner)[0].reading_hiragana).toBe('なまもの');
  });
  it('matches scope and lesson on the same source occurrence', () => {
    const e = entry('共有', [source('初级', 1), source('中级', 2)]);
    expect(e.sources.some((s) => sourceMatches(s, { scope: 'beginner', lesson: '中级:2' }))).toBe(
      false,
    );
    expect(referencesFor([e])).toBe('初级1；中级2');
    expect(referencesFor([e], { scope: 'beginner', lesson: '初级:1' })).toBe('初级1');
  });
  it('finds only actual shared characters in the chosen scope', () => {
    expect(vocab.related('発', beginner).map((w) => w.text)).toEqual(
      expect.arrayContaining(['発音', '発展']),
    );
    expect(vocab.related('発', beginner).map((w) => w.text)).not.toContain('発表');
    expect(vocab.related('发', all)).toHaveLength(0);
  });
  it('does not leak another scope’s readings into search', () => {
    expect(vocab.search('セイブツ', all)[0].text).toBe('生物');
    expect(vocab.search('せいぶつ', beginner)).toHaveLength(0);
    expect(vocab.search('なまもの', beginner)[0].text).toBe('生物');
  });
  it('supports a custom seed and handles a range without connected words', () => {
    expect(vocab.get(wordId('未収録語')).kanji).toContain('語');
    expect(vocab.get(wordId('未収録語')).entries).toEqual([]);
    expect(vocab.random({ scope: 'beginner', lesson: '初级:48' })).toBeUndefined();
  });
});

describe('point-to-network expansion', () => {
  it('expands only the clicked character and retains earlier branches', () => {
    let net = expandNetwork(startNetwork(wordId('発表')), '発', vocab, all);
    expect(net.words).toContain(wordId('発音'));
    expect(net.words).not.toContain(wordId('表面'));
    net = expandNetwork({ ...net, selected: wordId('発音') }, '音', vocab, all);
    expect(net.words).toContain(wordId('音楽'));
    expect(net.words).toContain(wordId('発表'));
    const graph = graphOf(net, vocab);
    expect(graph.edges.some((e) => e.source === 'kanji:音' && e.target === wordId('発音'))).toBe(
      true,
    );
    expect(graph.edges.every((e) => vocab.get(e.target).kanji.includes(e.kanji))).toBe(true);
  });
  it('creates one shared hub and no duplicate nodes or edges', () => {
    let net = startNetwork(wordId('発表'));
    for (let n = 0; n < 5; n++) net = expandNetwork(net, '発', vocab, all);
    const graph = graphOf(net, vocab);
    expect(graph.nodes.filter((n) => n.id === 'kanji:発')).toHaveLength(1);
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
    expect(new Set(graph.edges.map((e) => e.id)).size).toBe(graph.edges.length);
  });
  it('rejects a character outside the current word', () => {
    const net = startNetwork(wordId('発表'));
    expect(expandNetwork(net, '学', vocab, all)).toBe(net);
  });
  it('adds results in batches and caps network growth', () => {
    const many = fixture(Array.from({ length: 200 }, (_, i) => entry(`発${i}`)));
    let net = expandNetwork(startNetwork(wordId('発0')), '発', many, all);
    expect(net.words).toHaveLength(BATCH_SIZE + 1);
    for (let i = 0; i < 40; i++) net = expandNetwork(net, '発', many, all);
    expect(net.words).toHaveLength(MAX_WORDS);
  });
});

describe('production vocabulary integrity', () => {
  const data: Dataset = JSON.parse(readFileSync('public/vocabulary.json', 'utf8'));
  it('ships the complete approved vocabulary without the review queue', () => {
    const raw = JSON.parse(readFileSync('data/vocabulary/vocabulary.json', 'utf8'));
    expect(data.entries.map((e) => e.id)).toEqual(raw.entries.map((e: Entry) => e.id));
    expect(data.metadata.entryCount).toBe(data.entries.length);
    expect('ambiguous' in data).toBe(false);
    expect(new Vocabulary(data).words.size).toBeGreaterThan(5000);
  });
  it('keeps corrected references and original evidence and labels lemma meanings', () => {
    const skate = data.entries.find((e) => e.word === 'スケート')!;
    expect(skate.sources[0].lessons[1].symbol).toBe('');
    expect(skate.sources[0].raw_line).toContain('23ス');
    for (const e of data.entries.filter((e) => e.inflection))
      expect(e.meanings_scope).toBe('lemma');
  });
});
