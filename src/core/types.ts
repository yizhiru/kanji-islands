export type Level = '初级' | '中级';
export type Scope = 'all' | 'textbook' | 'beginner' | 'intermediate';
export interface Lesson {
  lesson: number;
  symbol: string;
}
export interface Source {
  level: Level;
  lessons: Lesson[];
  original_word: string;
  raw_line: string;
  pdf_page: number;
  book_page: number;
}
export interface Sense {
  id: string;
  zh: string[];
  en: string[];
  pos: string[];
  labels: string[];
  notes_zh: string[];
  notes_en: string[];
}
export interface Entry {
  id: string;
  word: string;
  reading_hiragana: string;
  jmdict_id: number;
  meanings_zh: string[];
  meanings_en: string[];
  senses: Sense[];
  sources: Source[];
  references: string;
  meanings_scope?: string;
  inflection?: { lemma: string; form: string; lemma_reading_hiragana: string };
  priority?: number;
}
export interface Dataset {
  version: 1;
  metadata: {
    entryCount: number;
    pendingGroups: number;
    sourceHash: string;
    chineseVersion: string;
    englishVersion: string;
    dictionaryEntries?: number;
    textbookEntries?: number;
    textbookWords?: number;
    englishOnlyEntries?: number;
  };
  entries: Entry[];
}
export interface PackedDataset {
  version: 2;
  metadata: Dataset['metadata'];
  senses: Sense[];
  entries: (Omit<Entry, 'senses' | 'meanings_zh' | 'meanings_en' | 'references' | 'sources'> & {
    sense_ids: number[];
    sources?: Source[];
  })[];
}
export interface Word {
  id: string;
  text: string;
  kanji: string[];
  entries: Entry[];
}
export interface Filter {
  scope: Scope;
  lesson: string;
}
export interface Expansion {
  kanji: string;
  parent: string;
  limit: number;
}
export interface Network {
  root: string;
  selected: string;
  words: string[];
  expansions: Expansion[];
}
export interface AppBridge {
  openSource: (level: Level, page: number) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  openDictionary: (word: string, reading: string) => Promise<void>;
}
declare global {
  interface Window {
    islands?: AppBridge;
  }
}
