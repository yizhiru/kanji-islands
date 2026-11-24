export const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, '');
export const hiragana = (value: string) =>
  normalize(value).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
export const kanjiOf = (value: string) => [
  ...new Set([...normalize(value)].filter((c) => /\p{Unified_Ideograph}/u.test(c))),
];
export const wordId = (text: string) => `word:${normalize(text)}`;
