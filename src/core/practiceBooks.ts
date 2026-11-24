import { hiragana, wordId } from './japaneseText';
import type { Vocabulary } from './vocabulary';

export interface PracticeCard {
  word: string;
  reading?: string;
  meaning?: string;
  meaning_en?: string;
}

export interface PracticeBook {
  id: string;
  name: string;
  cards: PracticeCard[];
}

export function practiceAnswer(card: PracticeCard, vocab: Vocabulary) {
  const entries = vocab
    .get(wordId(card.word))
    .entries.filter(
      (entry) => !card.reading || hiragana(entry.reading_hiragana) === hiragana(card.reading),
    );
  const readings = card.reading
    ? [card.reading]
    : [...new Set(entries.map((entry) => entry.reading_hiragana).filter(Boolean))];
  if (!readings.length && /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(card.word))
    readings.push(hiragana(card.word));
  const meaning =
    card.meaning ||
    [...new Set(entries.flatMap((entry) => entry.meanings_zh))].join('；') ||
    card.meaning_en ||
    [...new Set(entries.flatMap((entry) => entry.meanings_en))].join('; ');
  return { readings, meaning };
}

// Excel CSV can contain commas, CRLFs and doubled quotes inside quoted fields.
function csvRows(source: string): string[][] {
  const input = source.replace(/^\uFEFF/, '').replace(/^(?:(?:#[^\r\n]*|[ \t]*)\r?\n)+/, '');
  if (input.includes('\uFFFD')) throw new Error('文件编码无法识别，请另存为 UTF-8 CSV。');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i <= input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === undefined) throw new Error('CSV 中有未闭合的双引号。');
      if (c !== '"') value += c;
      else if (input[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (c === ',' || c === '\r' || c === '\n' || c === undefined) {
      row.push(value.trim());
      value = '';
      closed = false;
      if (c !== ',') {
        if (row.length > 1 || row[0]) rows.push(row);
        row = [];
        if (c === '\r' && input[i + 1] === '\n') i++;
      }
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (closed || c === '"') throw new Error('CSV 引号格式有误，请检查后重新导入。');
    else value += c;
  }
  return rows;
}

export function parsePracticeCsv(source: string): PracticeCard[] {
  const [header = [], ...rows] = csvRows(source);
  const names = header.map((name) => name.toLowerCase());
  const column = (...aliases: string[]) => names.findIndex((name) => aliases.includes(name));
  const word = column('word', '单词');
  if (word < 0) throw new Error('CSV 表头缺少 word（单词）列。可下载示例查看格式。');
  const reading = column('reading', '假名');
  const meaning = column('meaning', 'meaning_zh', '释义');
  const english = column('meaning_en');
  const cards = rows.map((row, i) => {
    if (row.length > header.length)
      throw new Error(`第 ${i + 1} 条词汇的列数与表头不一致。含逗号的释义请用双引号包围。`);
    if (!row[word]) throw new Error(`第 ${i + 1} 条词汇缺少单词。`);
    return {
      word: row[word],
      reading: row[reading],
      meaning: row[meaning],
      meaning_en: row[english],
    };
  });
  if (!cards.length) throw new Error('词本没有词条，请在表头下方添加单词。');
  return cards;
}

// Each operation uses one transaction so concurrent imports cannot replace another book.
async function withPracticeStore<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => IDBRequest<T>,
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('kanji-islands-practice-books', 2);
    open.onupgradeneeded = (event) => {
      if (event.oldVersion < 1) open.result.createObjectStore('books', { keyPath: 'id' });
      open.result.createObjectStore('removedCards', { keyPath: ['bookId', 'key'] });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const request = run(tx);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const loadPracticeBooks = (): Promise<PracticeBook[]> =>
  withPracticeStore('books', 'readonly', (tx) => tx.objectStore('books').getAll());
export const savePracticeBook = (book: PracticeBook) =>
  withPracticeStore('books', 'readwrite', (tx) => tx.objectStore('books').add(book));

interface RemovedCard {
  bookId: string;
  key: string;
}
export const loadRemovedCards = (): Promise<RemovedCard[]> =>
  withPracticeStore('removedCards', 'readonly', (tx) => tx.objectStore('removedCards').getAll());

export async function setCardRemoved(bookId: string, key: string, removed: boolean) {
  if (removed) {
    await withPracticeStore('removedCards', 'readwrite', (tx) =>
      tx.objectStore('removedCards').put({ bookId, key }),
    );
  } else {
    await withPracticeStore('removedCards', 'readwrite', (tx) =>
      tx.objectStore('removedCards').delete([bookId, key]),
    );
  }
}

// Array keys sort after strings, so this range covers exactly this book's card keys.
const removedRange = (bookId: string) => IDBKeyRange.bound([bookId], [bookId, []]);
export const restorePracticeCards = (bookId: string) =>
  withPracticeStore('removedCards', 'readwrite', (tx) =>
    tx.objectStore('removedCards').delete(removedRange(bookId)),
  );

export const deletePracticeBook = (id: string) =>
  withPracticeStore(['books', 'removedCards'], 'readwrite', (tx) => {
    tx.objectStore('removedCards').delete(removedRange(id));
    return tx.objectStore('books').delete(id);
  });
