export interface DictionaryBlock {
  ja: string;
  zh: string;
  en: string;
  kind: 'definition' | 'example' | 'note';
  context: string;
  sense?: number;
  label: string;
}
export interface DictionaryEntry {
  id: string;
  heading: string;
  pos: string[];
  blocks: DictionaryBlock[];
  format?: 'meikyo';
}
export interface DictionaryTerm {
  dictionaryId: string;
  text: string;
  reading: string;
  entryId: string;
}
export interface DictionaryInfo {
  id: string;
  title: string;
  revision: string;
  enabled: boolean;
  importedAt: number;
  termCount: number;
  entryCount: number;
  source: string;
}
export interface ParsedDictionary {
  info: DictionaryInfo;
  entries: DictionaryEntry[];
  terms: DictionaryTerm[];
}
export interface DictionaryMatch {
  dictionary: DictionaryInfo;
  entry: DictionaryEntry;
  via?: string;
}
