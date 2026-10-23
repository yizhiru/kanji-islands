import type { Dataset, Entry, Filter, Source, Word } from './types';

export const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, '');
export const hiragana = (value: string) =>
  normalize(value).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const kanjiOf = (value: string) => [
  ...new Set([...normalize(value)].filter((c) => /\p{Unified_Ideograph}/u.test(c))),
];
export const wordId = (text: string) => `word:${normalize(text)}`;
const collator = new Intl.Collator('ja');

export function sourceMatches(source: Source, filter: Filter): boolean {
  if (filter.scope === 'beginner' && source.level !== '初级') return false;
  if (filter.scope === 'intermediate' && source.level !== '中级') return false;
  if (!filter.lesson) return true;
  const [level, lesson] = filter.lesson.split(':');
  return source.level === level && source.lessons.some((r) => r.lesson === Number(lesson));
}

export const entriesFor = (word: Word, filter: Filter) =>
  word.entries.filter((e) => e.sources.some((s) => sourceMatches(s, filter)));

export function referencesFor(entries: Entry[], filter?: Filter): string {
  return (['初级', '中级'] as const)
    .map((level) => {
      const refs = new Map<string, { lesson: number; symbol: string }>();
      for (const entry of entries)
        for (const source of entry.sources) {
          if (source.level !== level || (filter && !sourceMatches(source, filter))) continue;
          for (const ref of source.lessons) {
            if (filter?.lesson && ref.lesson !== Number(filter.lesson.split(':')[1])) continue;
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

  constructor(readonly data: Dataset) {
    if (
      data.version !== 1 ||
      !Array.isArray(data.entries) ||
      data.entries.length !== data.metadata.entryCount
    ) {
      throw new Error('词库格式或条目数量不正确，请重新执行 npm run data:build。');
    }
    for (const entry of data.entries) {
      const id = wordId(entry.word);
      const word = this.words.get(id) ?? {
        id,
        text: entry.word,
        kanji: kanjiOf(entry.word),
        entries: [],
      };
      word.entries.push(entry);
      this.words.set(id, word);
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
    return [...this.words.values()].filter((word) => entriesFor(word, filter).length > 0);
  }

  related(kanji: string, filter: Filter, exclude?: string): Word[] {
    return [...(this.byKanji.get(kanji) ?? [])]
      .filter((id) => id !== exclude)
      .map((id) => this.words.get(id)!)
      .filter((word) => entriesFor(word, filter).length > 0)
      .sort(
        (a, b) =>
          a.kanji.length - b.kanji.length ||
          a.text.length - b.text.length ||
          collator.compare(a.text, b.text),
      );
  }

  search(query: string, filter: Filter, limit = 8): Word[] {
    const q = hiragana(query).toLowerCase();
    if (!q) return [];
    return [...this.words.values()]
      .filter((word) => {
        const entries = entriesFor(word, filter);
        if (!entries.length || !this.searchable.get(word.id)!.includes(q)) return false;
        const scoped = hiragana(
          [
            word.text,
            ...entries.flatMap((e) => [e.reading_hiragana, ...e.meanings_zh, ...e.meanings_en]),
          ].join('|'),
        ).toLowerCase();
        return scoped.includes(q);
      })
      .sort((a, b) => {
        const rank = (word: Word) =>
          normalize(word.text) === normalize(query)
            ? 0
            : word.text.startsWith(normalize(query))
              ? 1
              : 2;
        return rank(a) - rank(b) || collator.compare(a.text, b.text);
      })
      .slice(0, limit);
  }

  random(filter: Filter, random = Math.random): Word | undefined {
    const active = this.inScope(filter);
    const ids = new Set(active.map((w) => w.id));
    const pool = active.filter((w) =>
      w.kanji.some((k) =>
        [...(this.byKanji.get(k) ?? [])].some((id) => id !== w.id && ids.has(id)),
      ),
    );
    return pool[Math.floor(Math.min(0.999999, Math.max(0, random())) * pool.length)];
  }
}
