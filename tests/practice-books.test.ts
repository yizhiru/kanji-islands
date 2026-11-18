import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePracticeCsv, practiceAnswer } from '../src/core/practiceBooks';
import { Vocabulary } from '../src/core/vocabulary';

describe('practice CSV', () => {
  it('keeps the complete shipped Shikken list in rank order, including alternate readings', () => {
    const cards = parsePracticeCsv(readFileSync('src/assets/shikken-jlpt-n2-en.csv', 'utf8'));
    expect(cards).toHaveLength(1739);
    expect(cards[0].word).toBe('揚げる');
    expect(cards.at(-1)?.word).toBe('おまちどおさま');
    expect(cards.every((card) => card.word && card.reading && card.meaning_en)).toBe(true);
    expect(
      cards
        .filter((card) => card.word === '紅葉')
        .map((card) => card.reading)
        .sort(),
    ).toEqual(['こうよう', 'もみじ']);
  });

  it('reads the example, a word-only sheet and multiline CSV saved by a spreadsheet', () => {
    expect(parsePracticeCsv(readFileSync('public/practice-example.csv', 'utf8'))[0].word).toBe(
      '木漏れ日',
    );
    expect(parsePracticeCsv('word\r\n水\r\n空').map((card) => card.word)).toEqual(['水', '空']);
    expect(parsePracticeCsv('word,reading,meaning\n水\n空,そら')).toEqual([
      { word: '水' },
      { word: '空', reading: 'そら' },
    ]);
    expect(
      parsePracticeCsv('\uFEFF释义,单词,假名\r\n"turn, ""signal""\r\ncue",合図,あいず\r\n'),
    ).toEqual([{ word: '合図', reading: 'あいず', meaning: 'turn, "signal"\r\ncue' }]);
  });

  it.each([
    'reading,meaning\nあいず,信号',
    'word\n',
    'word,reading\n水,みず\n,みず',
    'word,meaning\n水,water,liquid',
    'word,meaning\n水,"water',
  ])('rejects a malformed or empty book as a whole', (source) =>
    expect(() => parsePracticeCsv(source)).toThrow(),
  );
});

it('uses the supplied reading to choose the Chinese sense and falls back to the original English', () => {
  const vocab = new Vocabulary({
    version: 1,
    metadata: {
      entryCount: 2,
      pendingGroups: 0,
      sourceHash: '',
      chineseVersion: '',
      englishVersion: '',
    },
    entries: [
      { word: '鈍い', reading_hiragana: 'にぶい', meanings_zh: ['迟钝'], meanings_en: [] },
      { word: '鈍い', reading_hiragana: 'のろい', meanings_zh: [], meanings_en: [] },
    ].map((entry, i) => ({
      ...entry,
      id: String(i),
      jmdict_id: i,
      sources: [],
      senses: [],
      references: '',
    })),
  });
  expect(practiceAnswer({ word: '鈍い', reading: 'にぶい' }, vocab).meaning).toBe('迟钝');
  expect(practiceAnswer({ word: '鈍い', reading: 'のろい', meaning_en: 'slow' }, vocab)).toEqual({
    readings: ['のろい'],
    meaning: 'slow',
  });
  expect(
    practiceAnswer({ word: '鈍い', reading: 'にぶい', meaning: '自用释义' }, vocab).meaning,
  ).toBe('自用释义');
  expect(practiceAnswer({ word: 'テスト' }, vocab).readings).toEqual(['てすと']);
});
