import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { Dataset, PackedDataset, Entry, Filter, Source } from '../src/core/types';
import {
  entriesFor,
  decodeDataset,
  kanjiOf,
  referencesFor,
  sourceMatches,
  Vocabulary,
  wordId,
} from '../src/core/vocabulary';
import {
  BATCH_SIZE,
  expandNetwork,
  collapsedNetwork,
  graphOf,
  MAX_WORDS,
  removeExpansion,
  startNetwork,
} from '../src/core/network';

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
  it('ranks beginner, intermediate, then unmatched candidates before dictionary frequency', () => {
    const ordered = fixture([
      { ...entry('発外', []), priority: 10000 },
      { ...entry('発中', [source('中级', 1)]), priority: 5000 },
      { ...entry('発初'), priority: 0 },
      entry('発両', [source('中级', 1), source('初级', 2)]),
    ]);
    const words = ordered.related('発', all).map((w) => w.text);
    expect(new Set(words.slice(0, 2))).toEqual(new Set(['発初', '発両']));
    expect(words.slice(2)).toEqual(['発中', '発外']);
    expect(ordered.related('発', { scope: 'intermediate', lesson: '' }).map((w) => w.text)).toEqual(
      ['発中', '発両'],
    );
    expect(ordered.related('発', { scope: 'all', lesson: '中级:1' }).map((w) => w.text)).toEqual([
      '発中',
      '発両',
    ]);
    const batched = fixture([
      ...Array.from({ length: 10 }, (_, i) => ({
        ...entry(`発中${i}`, [source('中级', 1)]),
        priority: 5000,
      })),
      ...Array.from({ length: 10 }, (_, i) => entry(`発初${i}`)),
      { ...entry('発外', []), priority: 10000 },
    ]);
    const network = expandNetwork(startNetwork(wordId('発点')), '発', batched, all);
    expect(network.words.slice(1).every((id) => id.startsWith('word:発初'))).toBe(true);
  });
  it('includes dictionary-only entries in the main library without inventing textbook lessons', () => {
    const dictionary = fixture([
      entry('量子計算', [], 'りょうしけいさん'),
      entry('計算'),
      entry('表面', [source('中级', 2)]),
    ]);
    expect(dictionary.search('量子', all)[0].text).toBe('量子計算');
    expect(dictionary.inScope(all)).toHaveLength(3);
    expect(dictionary.inScope({ scope: 'textbook', lesson: '' }).map((w) => w.text)).toEqual([
      '計算',
      '表面',
    ]);
    expect(dictionary.search('量子', beginner)).toEqual([]);
    expect(dictionary.inScope({ scope: 'all', lesson: '初级:1' }).map((w) => w.text)).toEqual([
      '計算',
    ]);
    expect(referencesFor(dictionary.get(wordId('量子計算')).entries)).toBe('');
  });
  it('uses complete Unicode kanji and ignores kana, repeated characters and iteration marks', () => {
    expect(kanjiOf('時々、時に𠮷！')).toEqual(['時', '𠮷']);
    expect(kanjiOf('カタカナ')).toEqual([]);
  });
  it('groups spellings without dropping multiple readings', () => {
    expect(vocab.get(wordId('生物')).entries).toHaveLength(2);
    expect(entriesFor(vocab.get(wordId('生物')), beginner)[0].reading_hiragana).toBe('なまもの');
    const textbook: Filter = { scope: 'textbook', lesson: '' };
    expect(entriesFor(vocab.get(wordId('生物')), textbook)).toHaveLength(2);
    expect(referencesFor(entriesFor(vocab.get(wordId('生物')), textbook), textbook)).toBe(
      '初级1；中级2',
    );
    expect(vocab.search('せいぶつ', textbook)[0].text).toBe('生物');
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
  it('keeps the two most recently expanded characters and connecting routes without changing history', () => {
    const chain = fixture(
      ['発表', '発音', '発展', '音楽', '音声', '楽園', '楽曲', '園芸'].map((w) => entry(w)),
    );
    let net = expandNetwork(startNetwork(wordId('発表')), '発', chain, all);
    net = expandNetwork({ ...net, selected: wordId('発音') }, '音', chain, all);
    expect(collapsedNetwork(net, chain)).toBe(net);
    const twoLayers = net;
    net = expandNetwork({ ...net, selected: wordId('音楽') }, '楽', chain, all);
    const original = JSON.stringify(net);
    const focused = collapsedNetwork(net, chain);
    expect(focused.words).not.toContain(wordId('発展'));
    expect(focused.words).toEqual(
      expect.arrayContaining(['発表', '発音', '音楽', '音声', '楽園', '楽曲'].map(wordId)),
    );
    expect(focused.expansions.map((e) => e.kanji)).toEqual(['発', '音', '楽']);
    expect(JSON.stringify(net)).toBe(original);
    expect(collapsedNetwork(twoLayers, chain)).toBe(twoLayers);
    const selectedOldWord = collapsedNetwork({ ...net, selected: wordId('発展') }, chain);
    expect(selectedOldWord.words).toContain(wordId('発展'));
    net = expandNetwork({ ...net, selected: wordId('楽園') }, '園', chain, all);
    const deeper = collapsedNetwork(net, chain);
    expect(deeper.words).not.toContain(wordId('音声'));
    expect(deeper.words).toContain(wordId('音楽'));
    expect(deeper.words).toContain(wordId('園芸'));
    expect(collapsedNetwork(removeExpansion(net, '楽', chain), chain).words).toContain(
      wordId('発展'),
    );
  });
  it('folds older character groups even when all three expansions start at the same word', () => {
    const branches = fixture(['発表音', '発展', '表面', '音楽'].map((w) => entry(w)));
    let net = startNetwork(wordId('発表音'));
    for (const kanji of ['発', '表', '音']) net = expandNetwork(net, kanji, branches, all);
    const collapsed = collapsedNetwork(net, branches);
    expect(collapsed.words).toEqual(['発表音', '表面', '音楽'].map(wordId));
    expect(collapsed.expansions.map((e) => e.kanji)).toEqual(['表', '音']);
    expect(collapsedNetwork(net, branches, 1).words).toEqual(['発表音', '音楽'].map(wordId));
    expect(collapsedNetwork(net, branches, 3)).toBe(net);
    expect(collapsedNetwork(net, branches, NaN).words).toEqual(collapsed.words);
    expect(collapsedNetwork(net, branches, 0).words).toEqual(
      collapsedNetwork(net, branches, 1).words,
    );
    const selectedOld = collapsedNetwork({ ...net, selected: wordId('発展') }, branches, 1);
    expect(selectedOld.words).toContain(wordId('発展'));
    expect(selectedOld.expansions.map((e) => e.kanji)).toEqual(['発', '音']);
    net = expandNetwork(net, '発', branches, all);
    expect(net.expansions.map((e) => e.kanji)).toEqual(['表', '音', '発']);
    expect(collapsedNetwork(net, branches).words).toEqual(['発表音', '発展', '音楽'].map(wordId));
    expect(new Set(net.expansions.map((e) => e.kanji)).size).toBe(3);
  });
  it('preserves words shared with recent groups and connecting paths through cycles', () => {
    const shared = fixture(['発表音', '発展', '発音', '表面', '音楽'].map((w) => entry(w)));
    let net = startNetwork(wordId('発表音'));
    for (const kanji of ['発', '表', '音']) net = expandNetwork(net, kanji, shared, all);
    const collapsed = collapsedNetwork(net, shared, 1);
    expect(collapsed.words).toContain(wordId('発音'));
    expect(collapsed.words).not.toContain(wordId('発展'));
    expect(collapsed.words).not.toContain(wordId('表面'));
    expect(collapsedNetwork(removeExpansion(net, '音', shared), shared).words).toContain(
      wordId('発展'),
    );
  });
  it('removes a hub and detached descendants, resets selection, and allows re-expansion', () => {
    let net = expandNetwork(startNetwork(wordId('発表')), '発', vocab, all);
    net = expandNetwork({ ...net, selected: wordId('発音') }, '音', vocab, all);
    const before = JSON.stringify(net);
    const removed = removeExpansion(net, '発', vocab);
    expect(removed).toEqual(startNetwork(wordId('発表')));
    expect(JSON.stringify(net)).toBe(before);
    expect(expandNetwork(removed, '発', vocab, all).words).toContain(wordId('発音'));
    expect(removeExpansion(net, '学', vocab)).toBe(net);
  });
  it('preserves shared words and independent branches while removing exclusive candidates', () => {
    let net = expandNetwork(startNetwork(wordId('発表')), '発', vocab, all);
    net = expandNetwork(net, '表', vocab, all);
    const removed = removeExpansion({ ...net, selected: wordId('発音') }, '発', vocab);
    expect(removed.words).toEqual([wordId('発表'), wordId('表面')]);
    expect(removed.expansions.map((e) => e.kanji)).toEqual(['表']);
    expect(removed.selected).toBe(wordId('発表'));

    let nested = expandNetwork(startNetwork(wordId('発表')), '発', vocab, all);
    nested = expandNetwork({ ...nested, selected: wordId('発音') }, '音', vocab, all);
    const leafRemoved = removeExpansion({ ...nested, selected: wordId('音楽') }, '音', vocab);
    expect(leafRemoved.words).toContain(wordId('発音'));
    expect(leafRemoved.words).not.toContain(wordId('音楽'));
    expect(leafRemoved.selected).toBe(wordId('発音'));
    expect(graphOf(leafRemoved, vocab).edges.every((e) => e.kanji !== '音')).toBe(true);
  });
  it('prunes cycles detached from the seed instead of retaining orphaned words and hubs', () => {
    const cyclic = fixture(['発表', '発音', '音楽', '楽発'].map((word) => entry(word)));
    let net = expandNetwork(startNetwork(wordId('発表')), '発', cyclic, all);
    net = expandNetwork({ ...net, selected: wordId('発音') }, '音', cyclic, all);
    net = expandNetwork({ ...net, selected: wordId('音楽') }, '楽', cyclic, all);
    expect(removeExpansion(net, '発', cyclic)).toEqual(startNetwork(wordId('発表')));
  });
  it('keeps cross-connected descendants reachable through another remaining hub', () => {
    const shared = fixture(['発表', '発電', '発表音', '表面', '音楽'].map((word) => entry(word)));
    let net = expandNetwork(startNetwork(wordId('発表')), '発', shared, all);
    net = expandNetwork({ ...net, selected: wordId('発表音') }, '音', shared, all);
    net = expandNetwork({ ...net, selected: wordId('発表') }, '表', shared, all);
    const removed = removeExpansion(net, '発', shared);
    expect(removed.words).not.toContain(wordId('発電'));
    expect(removed.words).toEqual(
      expect.arrayContaining(['発表', '発表音', '表面', '音楽'].map(wordId)),
    );
    expect(removed.expansions.map((e) => e.kanji)).toEqual(['音', '表']);
  });
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
  const packed: PackedDataset = JSON.parse(readFileSync('public/vocabulary.json', 'utf8'));
  const data = decodeDataset(packed);
  it('ships the standard dictionary and every curated textbook entry without the review queue', () => {
    const ids = new Set(data.entries.map((e) => e.id));
    expect(ids.size).toBe(data.entries.length);
    expect(data.entries.filter((e) => e.sources.length)).toHaveLength(
      data.metadata.textbookEntries!,
    );
    expect(data.metadata.entryCount).toBe(data.entries.length);
    expect(data.metadata.dictionaryEntries).toBeGreaterThan(200000);
    expect(data.entries.some((e) => !e.sources.length && e.senses.length > 0)).toBe(true);
    expect('ambiguous' in data).toBe(false);
    expect(new Set(data.entries.map((e) => e.word)).size).toBeGreaterThan(200000);
    expect(packed.senses.length).toBeLessThan(
      data.entries.reduce((sum, e) => sum + e.senses.length, 0),
    );
  });
  it.skipIf(!existsSync('data/vocabulary/vocabulary.json'))(
    'retains every verified textbook source on the exact word, reading and dictionary ID',
    () => {
      const raw = JSON.parse(readFileSync('data/vocabulary/vocabulary.json', 'utf8'));
      const byID = new Map(data.entries.map((e) => [e.id, e]));
      expect(data.metadata.textbookEntries).toBe(raw.entries.length);
      for (const entry of raw.entries) {
        const built = byID.get(entry.id)!;
        expect([built.word, built.reading_hiragana, built.jmdict_id]).toEqual([
          entry.word,
          entry.reading_hiragana,
          entry.jmdict_id,
        ]);
        expect(built.sources.map((s) => s.lessons)).toEqual(
          entry.sources.map(
            (s: Source & { corrected_lessons?: Source['lessons'] }) =>
              s.corrected_lessons ?? s.lessons,
          ),
        );
      }
    },
  );
  it('keeps corrected references and original evidence and labels lemma meanings', () => {
    const skate = data.entries.find((e) => e.word === 'スケート')!;
    expect(skate.sources[0].lessons[1].symbol).toBe('');
    expect(skate.sources[0].raw_line).toContain('23ス');
    for (const e of data.entries.filter((e) => e.inflection))
      expect(e.meanings_scope).toBe('lemma');
  });
});
