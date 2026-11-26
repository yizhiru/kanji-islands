import { normalize, hiragana, wordId, kanjiOf } from './japaneseText';
import { isN2Reading } from './n2';
export { normalize, hiragana, wordId, kanjiOf } from './japaneseText';
import type { Dataset, Entry, Filter, PackedDataset, LessonSource, Word } from './types';

export function decodeDataset(data: Dataset | PackedDataset): Dataset {
  if (data.version !== 2) return data as Dataset;
  if (data.entries.length !== data.metadata.entryCount) throw new Error('词库条目数量不正确。');
  return {
    version: 1,
    metadata: data.metadata,
    textbookIndex: data.textbookIndex,
    entries: data.entries.map(({ sense_ids, ...entry }) => {
      const senses = sense_ids.map((id) => data.senses[id]);
      if (!senses.length || senses.some((s) => !s)) throw new Error('词库义项索引不正确。');
      return {
        ...entry,
        senses,
        meanings_zh: [...new Set(senses.flatMap((s) => s.zh))],
        meanings_en: [...new Set(senses.flatMap((s) => s.en))],
        sources: entry.sources ?? [],
        references: '',
      };
    }),
  };
}

const collator = new Intl.Collator('ja');

export function sourceMatches(source: LessonSource, filter: Filter): boolean {
  if (filter.scope === 'beginner' && source.level !== '初级') return false;
  if (filter.scope === 'intermediate' && source.level !== '中级') return false;
  return true;
}

export const entriesFor = (word: Word, filter: Filter) =>
  filter.scope === 'all'
    ? word.entries
    : word.entries.filter((e) => e.sources.some((s) => sourceMatches(s, filter)));

function wordMatches(word: Word, filter: Filter) {
  return filter.scope === 'all' || !!word.lessonSources?.some((s) => sourceMatches(s, filter));
}

function studyRank(word: Word, entries: Entry[], filter: Filter) {
  if (isN2Reading(word.text, entries)) return 0;
  const sources = word.lessonSources?.filter((s) => sourceMatches(s, filter)) ?? [];
  return sources.some((s) => s.level === '初级') ? 1 : sources.length ? 2 : 3;
}

export function referencesFor(entries: Entry[], filter?: Filter): string {
  return formatReferences(
    entries.flatMap((e) => e.sources),
    filter,
  );
}

export function wordReferences(word: Word, filter?: Filter): string {
  return formatReferences(word.lessonSources ?? [], filter);
}

function formatReferences(sources: LessonSource[], filter?: Filter): string {
  return (['初级', '中级'] as const)
    .map((level) => {
      const refs = new Map<string, { lesson: number; symbol: string }>();
      for (const source of sources) {
        if (source.level !== level || (filter && !sourceMatches(source, filter))) continue;
        for (const ref of source.lessons) {
          refs.set(`${ref.lesson}${ref.symbol}`, ref);
        }
      }
      return refs.size
        ? level +
            [...refs.values()]
              .sort((a, b) => a.lesson - b.lesson || a.symbol.localeCompare(b.symbol))
              .map((r) => r.lesson + r.symbol)
              .join('、')
        : '';
    })
    .filter(Boolean)
    .join('；');
}

export class Vocabulary {
  readonly words = new Map<string, Word>();
  readonly byKanji = new Map<string, Set<string>>();
  private searchable = new Map<string, string>();
  private scopes = new Map<string, Word[]>();
  private relations = new Map<string, Word[]>();
  private randomPools = new Map<string, Word[]>();

  constructor(readonly data: Dataset) {
    if (
      data.version !== 1 ||
      !Array.isArray(data.entries) ||
      data.entries.length !== data.metadata.entryCount
    ) {
      throw new Error('词库格式或条目数量不正确，请重新执行 npm run data:build。');
    }
    const ensureWord = (text: string): Word => {
      const id = wordId(text);
      const existing = this.words.get(id);
      if (existing) return existing;
      const word: Word = { id, text, kanji: kanjiOf(text), entries: [] };
      this.words.set(id, word);
      return word;
    };
    for (const entry of data.entries) {
      const word = ensureWord(entry.word);
      word.entries.push(entry);
      if (!data.textbookIndex && entry.sources.length)
        (word.lessonSources ??= []).push(...entry.sources);
    }
    for (const row of data.textbookIndex ?? []) {
      for (const text of row.words) (ensureWord(text).lessonSources ??= []).push(row);
    }
    for (const word of this.words.values()) {
      for (const kanji of word.kanji) {
        if (!this.byKanji.has(kanji)) this.byKanji.set(kanji, new Set());
        this.byKanji.get(kanji)!.add(word.id);
      }
      this.searchable.set(
        word.id,
        hiragana(
          [
            word.text,
            ...word.entries.flatMap((e) => [
              e.reading_hiragana,
              ...e.meanings_zh,
              ...e.meanings_en,
            ]),
          ].join('|'),
        ).toLowerCase(),
      );
    }
  }

  get(id: string): Word {
    return (
      this.words.get(id) ?? {
        id,
        text: id.slice('word:'.length),
        kanji: kanjiOf(id.slice('word:'.length)),
        entries: [],
      }
    );
  }

  inScope(filter: Filter): Word[] {
    const key = filter.scope;
    if (!this.scopes.has(key))
      this.scopes.set(
        key,
        [...this.words.values()].filter((word) => wordMatches(word, filter)),
      );
    return this.scopes.get(key)!;
  }

  related(
    kanji: string,
    filter: Filter,
    exclude?: string,
    preferred?: ReadonlySet<string>,
  ): Word[] {
    const key = `${kanji}:${filter.scope}`;
    if (!this.relations.has(key))
      this.relations.set(
        key,
        [...(this.byKanji.get(kanji) ?? [])]
          .map((id) => this.words.get(id)!)
          .filter((word) => wordMatches(word, filter))
          .map((word) => {
            const entries = entriesFor(word, filter);
            return {
              word,
              studyRank: studyRank(word, entries, filter),
              priority: entries.length ? Math.max(...entries.map((e) => e.priority ?? 0)) : 0,
            };
          })
          .sort(
            (a, b) =>
              a.studyRank - b.studyRank ||
              b.priority - a.priority ||
              a.word.kanji.length - b.word.kanji.length ||
              a.word.text.length - b.word.text.length ||
              collator.compare(a.word.text, b.word.text),
          )
          .map(({ word }) => word),
      );
    const words = this.relations.get(key)!.filter((w) => w.id !== exclude);
    return preferred
      ? words.sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)))
      : words;
  }

  search(query: string, filter: Filter, limit = 8): Word[] {
    const q = hiragana(query).toLowerCase();
    if (!q) return [];
    const normalizedQuery = normalize(query);
    return this.inScope(filter)
      .filter((word) => {
        const entries = entriesFor(word, filter);
        if (!this.searchable.get(word.id)!.includes(q)) return false;
        if (filter.scope === 'all') return true;
        const scoped = hiragana(
          [
            word.text,
            ...entries.flatMap((e) => [e.reading_hiragana, ...e.meanings_zh, ...e.meanings_en]),
          ].join('|'),
        ).toLowerCase();
        return scoped.includes(q);
      })
      .map((word) => {
        const entries = entriesFor(word, filter);
        return {
          word,
          rank:
            normalize(word.text) === normalizedQuery
              ? 0
              : entries.some((e) => hiragana(e.reading_hiragana) === q)
                ? 1
                : normalize(word.text).startsWith(normalizedQuery)
                  ? 2
                  : 3,
          studyRank: studyRank(word, entries, filter),
          priority: entries.length ? Math.max(...entries.map((e) => e.priority ?? 0)) : 0,
        };
      })
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.studyRank - b.studyRank ||
          b.priority - a.priority ||
          collator.compare(a.word.text, b.word.text),
      )
      .slice(0, limit)
      .map(({ word }) => word);
  }

  random(filter: Filter, random = Math.random): Word | undefined {
    const key = filter.scope;
    if (!this.randomPools.has(key)) {
      const active = this.inScope(filter);
      const counts = new Map<string, number>();
      for (const word of active)
        for (const kanji of word.kanji) counts.set(kanji, (counts.get(kanji) ?? 0) + 1);
      this.randomPools.set(
        key,
        active.filter((w) => w.kanji.some((k) => counts.get(k)! > 1)),
      );
    }
    const pool = this.randomPools.get(key)!;
    return pool[Math.floor(Math.min(0.999999, Math.max(0, random())) * pool.length)];
  }
}
