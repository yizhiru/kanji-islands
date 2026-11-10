import type { Filter, Word } from './types';
import { entriesFor, Vocabulary, wordId } from './vocabulary';

// Explicit lexical pairs, qualified by reading: shared kanji or suffixes alone
// cannot establish a transitivity relationship (開く has multiple readings).
const pairs = [
  ['開く', 'あく', '開ける', 'あける'],
  ['閉まる', 'しまる', '閉める', 'しめる'],
  ['付く', 'つく', '付ける', 'つける'],
  ['消える', 'きえる', '消す', 'けす'],
  ['入る', 'はいる', '入れる', 'いれる'],
  ['出る', 'でる', '出す', 'だす'],
  ['上がる', 'あがる', '上げる', 'あげる'],
  ['下がる', 'さがる', '下げる', 'さげる'],
  ['始まる', 'はじまる', '始める', 'はじめる'],
  ['終わる', 'おわる', '終える', 'おえる'],
  ['止まる', 'とまる', '止める', 'とめる'],
  ['動く', 'うごく', '動かす', 'うごかす'],
  ['壊れる', 'こわれる', '壊す', 'こわす'],
  ['割れる', 'われる', '割る', 'わる'],
  ['折れる', 'おれる', '折る', 'おる'],
  ['破れる', 'やぶれる', '破る', 'やぶる'],
  ['落ちる', 'おちる', '落とす', 'おとす'],
  ['起きる', 'おきる', '起こす', 'おこす'],
  ['立つ', 'たつ', '立てる', 'たてる'],
  ['建つ', 'たつ', '建てる', 'たてる'],
  ['並ぶ', 'ならぶ', '並べる', 'ならべる'],
  ['集まる', 'あつまる', '集める', 'あつめる'],
  ['決まる', 'きまる', '決める', 'きめる'],
  ['変わる', 'かわる', '変える', 'かえる'],
  ['戻る', 'もどる', '戻す', 'もどす'],
  ['続く', 'つづく', '続ける', 'つづける'],
  ['届く', 'とどく', '届ける', 'とどける'],
  ['残る', 'のこる', '残す', 'のこす'],
  ['直る', 'なおる', '直す', 'なおす'],
  ['治る', 'なおる', '治す', 'なおす'],
  ['育つ', 'そだつ', '育てる', 'そだてる'],
  ['増える', 'ふえる', '増やす', 'ふやす'],
  ['減る', 'へる', '減らす', 'へらす'],
  ['焼ける', 'やける', '焼く', 'やく'],
  ['煮える', 'にえる', '煮る', 'にる'],
  ['溶ける', 'とける', '溶かす', 'とかす'],
  ['乾く', 'かわく', '乾かす', 'かわかす'],
  ['汚れる', 'よごれる', '汚す', 'よごす'],
  ['倒れる', 'たおれる', '倒す', 'たおす'],
  ['見つかる', 'みつかる', '見つける', 'みつける'],
  ['掛かる', 'かかる', '掛ける', 'かける'],
] as const;

export function verbPairsFor(vocab: Vocabulary, word: Word, filter: Filter) {
  const matches = (candidate: Word, reading: string, pos: string) =>
    entriesFor(candidate, filter).some(
      (entry) =>
        !entry.inflection &&
        entry.reading_hiragana === reading &&
        entry.senses.some((sense) => sense.pos.includes(pos)),
    );
  return pairs.flatMap(([auto, autoReading, transitive, transitiveReading]) => {
    const a = vocab.get(wordId(auto));
    const t = vocab.get(wordId(transitive));
    if (word.id !== a.id && word.id !== t.id) return [];
    if (!matches(a, autoReading, 'vi') || !matches(t, transitiveReading, 'vt')) return [];
    return [{ auto: a, autoReading, transitive: t, transitiveReading }];
  });
}
