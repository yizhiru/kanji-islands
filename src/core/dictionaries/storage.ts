import { hiragana, normalize } from '../vocabulary';
import type { Entry } from '../types';
import type {
  DictionaryEntry,
  DictionaryInfo,
  DictionaryMatch,
  DictionaryTerm,
  ParsedDictionary,
} from './types';

const DB_NAME = 'kanji-islands-user-dictionaries';
export function openDictionaries(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('dictionaries', { keyPath: 'id' });
      db.createObjectStore('entries', { keyPath: ['dictionaryId', 'id'] }).createIndex(
        'dictionary',
        'dictionaryId',
      );
      const terms = db.createObjectStore('terms', {
        keyPath: ['dictionaryId', 'text', 'reading', 'entryId'],
      });
      terms.createIndex('text', 'text');
      terms.createIndex('dictionary', 'dictionaryId');
    };
    request.onerror = () => reject(new Error('无法打开本地词典存储。'));
    request.onblocked = () => reject(new Error('本地词典正在另一窗口更新，请关闭该窗口后重试。'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
const result = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('本地词典保存失败，请检查可用存储空间。'));
  });
export async function listDictionaries(): Promise<DictionaryInfo[]> {
  const db = await openDictionaries();
  try {
    return (
      (await result(
        db.transaction('dictionaries').objectStore('dictionaries').getAll(),
      )) as DictionaryInfo[]
    ).sort((a, b) => b.importedAt - a.importedAt);
  } finally {
    db.close();
  }
}
export async function saveDictionary(parsed: ParsedDictionary): Promise<void> {
  const db = await openDictionaries();
  try {
    const tx = db.transaction(['dictionaries', 'entries', 'terms'], 'readwrite');
    const done = finished(tx);
    // One atomic transaction: a failed/canceled import never leaves half a dictionary.
    tx.objectStore('dictionaries').put(parsed.info);
    for (const entry of parsed.entries)
      tx.objectStore('entries').put({ ...entry, dictionaryId: parsed.info.id });
    for (const term of parsed.terms) tx.objectStore('terms').put(term);
    await done;
  } finally {
    db.close();
  }
}
export async function enableDictionary(id: string, enabled: boolean): Promise<void> {
  const db = await openDictionaries();
  try {
    const tx = db.transaction('dictionaries', 'readwrite'),
      done = finished(tx),
      store = tx.objectStore('dictionaries');
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, enabled });
    };
    await done;
  } finally {
    db.close();
  }
}
export async function deleteDictionary(id: string): Promise<void> {
  const db = await openDictionaries();
  try {
    const tx = db.transaction(['dictionaries', 'entries', 'terms'], 'readwrite'),
      done = finished(tx);
    tx.objectStore('dictionaries').delete(id);
    // Both stores use compound keys starting with dictionaryId. Delete the
    // whole prefix in one operation instead of issuing 200,000 cursor deletes.
    const range = IDBKeyRange.bound([id], [id, []]);
    tx.objectStore('entries').delete(range);
    tx.objectStore('terms').delete(range);
    await done;
  } finally {
    db.close();
  }
}
export const hasLanguage = (entry: DictionaryEntry, lang: 'zh' | 'ja') =>
  entry.blocks.some((b) => b.kind === 'definition' && !!b[lang].trim());
export async function lookupDictionaries(
  text: string,
  entry: Entry,
  dictionaries: DictionaryInfo[],
): Promise<DictionaryMatch[]> {
  if (!dictionaries.some((d) => d.enabled)) return [];
  const db = await openDictionaries();
  try {
    const termsFor = async (word: string, dictionaryId: string, reading?: string) => {
      const rows = (await result(
        db.transaction('terms').objectStore('terms').index('text').getAll(normalize(word)),
      )) as DictionaryTerm[];
      return [
        ...new Set(
          rows
            .filter(
              (t) =>
                t.dictionaryId === dictionaryId && (!reading || t.reading === hiragana(reading)),
            )
            .map((t) => t.entryId),
        ),
      ];
    };
    const documentFor = async (id: string, key: string) =>
      (await result(db.transaction('entries').objectStore('entries').get([id, key]))) as
        DictionaryEntry | undefined;
    const follow = async (
      doc: DictionaryEntry,
      dictionary: DictionaryInfo,
      seen = new Set<string>(),
    ): Promise<{ entry: DictionaryEntry; via?: string }> => {
      if (hasLanguage(doc, 'ja') || hasLanguage(doc, 'zh') || seen.size >= 3 || seen.has(doc.id))
        return { entry: doc };
      seen.add(doc.id);
      const note = doc.blocks
        .filter((b) => b.kind === 'note')
        .map((b) => b.ja)
        .join('');
      const target = /⇨([^⇨⇔。\n]+)/.exec(note)?.[1]?.trim();
      if (!target || target.length > 80) return { entry: doc };
      const word = target.replace(/[（(].*$/, '').trim();
      const keys = await termsFor(word, dictionary.id);
      // Only unambiguous, explicit cross references; never guess a homophone.
      if (keys.length !== 1) return { entry: doc };
      const next = await documentFor(dictionary.id, keys[0]);
      if (!next) return { entry: doc };
      const resolved = await follow(next, dictionary, seen);
      return { entry: resolved.entry, via: `参照「${target}」（目标词条）` };
    };
    const found: DictionaryMatch[] = [];
    for (const dictionary of dictionaries.filter((d) => d.enabled)) {
      let keys = await termsFor(text, dictionary.id, entry.reading_hiragana),
        via: string | undefined;
      if (!keys.length && entry.inflection) {
        keys = await termsFor(
          entry.inflection.lemma,
          dictionary.id,
          entry.inflection.lemma_reading_hiragana,
        );
        via = `原形「${entry.inflection.lemma}」`;
      }
      if (!keys.length && text.endsWith('する') && entry.reading_hiragana.endsWith('する')) {
        const candidates = await termsFor(
          text.slice(0, -2),
          dictionary.id,
          entry.reading_hiragana.slice(0, -2),
        );
        const docs = await Promise.all(candidates.map((k) => documentFor(dictionary.id, k)));
        keys = docs.filter((d) => d?.pos.some((p) => p.includes('サ変'))).map((d) => d!.id);
        via = `サ变词「${text.slice(0, -2)}」`;
      }
      for (const key of keys) {
        const doc = await documentFor(dictionary.id, key);
        if (!doc) continue;
        const resolved = await follow(doc, dictionary);
        found.push({
          dictionary,
          entry: resolved.entry,
          via: [via, resolved.via].filter(Boolean).join('；') || undefined,
        });
      }
    }
    return found;
  } finally {
    db.close();
  }
}
