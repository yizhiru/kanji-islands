import csv from '../assets/shikken-jlpt-n2-en.csv?raw';
import { hiragana, normalize } from './japaneseText';
import { parsePracticeCsv, type PracticeBook } from './practiceBooks';
import type { Entry } from './types';

export const n2Book: PracticeBook = {
  id: 'shikken-n2',
  name: 'N2 核心词汇',
  cards: parsePracticeCsv(csv),
};
const readingsByWord = new Map<string, Set<string>>();
for (const card of n2Book.cards) {
  if (!card.reading) continue;
  const word = normalize(card.word);
  const readings = readingsByWord.get(word) ?? new Set<string>();
  readings.add(hiragana(card.reading));
  readingsByWord.set(word, readings);
}
export function isN2Reading(word: string, entries: Entry[]) {
  const readings = readingsByWord.get(normalize(word));
  return !!readings && entries.some((e) => readings.has(hiragana(e.reading_hiragana)));
}
