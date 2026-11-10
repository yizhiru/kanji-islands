import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseGlossary, parseYomitan } from '../src/core/dictionaries/parser';

const archive = (rows: unknown[], extra: Record<string, Uint8Array> = {}, sequenced = true) =>
  zipSync({
    'index.json': strToU8(
      JSON.stringify({
        format: 3,
        title: '测试词典',
        revision: '1',
        sequenced,
        targetLanguage: 'ja',
      }),
    ),
    'term_bank_1.json': strToU8(JSON.stringify(rows)),
    ...extra,
  });
const row = (text: string, reading: string, seq: number, gloss: unknown[] = ['日本語の意味']) => [
  text,
  reading,
  '',
  '',
  0,
  gloss,
  seq,
  '',
];

describe('local Yomitan parsing', () => {
  it('keeps homophones separate, deduplicates sequence aliases, and infers only kana readings', () => {
    const parsed = parseYomitan(
      archive([
        row('開く', 'あく', 1),
        row('あく', '', 1),
        row('開く', 'ひらく', 2),
        row('パソコン', '', 3),
      ]),
      'local',
    );
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.terms.map((t) => t.reading)).toEqual(['あく', 'あく', 'ひらく', 'ぱそこん']);
    expect(parsed.terms[0].entryId).not.toBe(parsed.terms[2].entryId);
  });
  it('preserves restricted meanings that share a sequence', () => {
    const parsed = parseYomitan(
      archive([row('甲', 'こう', 1, ['first']), row('乙', 'おつ', 1, ['second'])]),
      'x',
    );
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.terms[0].entryId).not.toBe(parsed.terms[1].entryId);
  });
  it('never merges unsequenced entries with sequence -1', () => {
    expect(
      parseYomitan(archive([row('甲', 'こう', -1), row('乙', 'おつ', -1)]), 'local').entries,
    ).toHaveLength(2);
  });
  it('separates bilingual main definitions, examples, group labels and spelling notes', () => {
    const node = (name: string, children: unknown[]) => ({
      tag: 'div',
      data: { class: name },
      content: children,
    });
    const zh = (s: string) => ({ tag: 'span', lang: 'zh', content: s });
    const parsed = parseGlossary(
      [
        {
          type: 'structured-content',
          content: node('mjrhsjcd-entry', [
            node('head', ['開く']),
            node('def0', ['自動詞']),
            node('def1', [
              node('num', ['①']),
              node('def2', ['〖開〗開いた状態になる。', zh('/ 打开。')]),
              node('exam', ['戸が開く', zh('门开了')]),
              node('biaoji', ['表記']),
              '写法说明',
            ]),
          ]),
        },
      ],
      'zh',
    );
    expect(parsed.blocks.find((b) => b.kind === 'definition')).toMatchObject({
      ja: '開いた状態になる。',
      zh: '打开。',
      context: '自動詞',
      label: '① 〖開〗',
    });
    expect(parsed.blocks.find((b) => b.kind === 'example')).toMatchObject({
      ja: '戸が開く',
      zh: '门开了',
    });
    expect(parsed.blocks.some((b) => b.kind === 'note' && b.ja.includes('写法说明'))).toBe(true);
  });
  it('rejects missing indexes, path traversal, damaged CRC and unsupported schemas', () => {
    expect(() => parseYomitan(zipSync({ 'term_bank_1.json': strToU8('[]') }), 'x')).toThrow();
    expect(() =>
      parseYomitan(archive([row('甲', 'こう', 1)], { '../escape': strToU8('x') }), 'x'),
    ).toThrow();
    expect(() => parseYomitan(archive([['invalid']]), 'x')).toThrow();
    const damaged = archive([row('甲', 'こう', 1)]);
    const view = new DataView(damaged.buffer);
    for (let i = 0; i < damaged.length - 20; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        damaged[i + 16] ^= 1;
        break;
      }
    }
    expect(() => parseYomitan(damaged, 'x')).toThrow(/校验|解压/);
  });
  it('limits nesting and reads dangerous markup only as escaped text data', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 45; i++) deep = { tag: 'div', content: deep };
    expect(() => parseGlossary([deep as never], 'ja')).toThrow('结构过深');
    const doc = parseGlossary(
      [{ type: 'structured-content', content: { tag: 'script', content: 'alert(1)' } }],
      'zh',
    );
    expect(doc.blocks[0].zh).toBe('alert(1)');
    expect(JSON.stringify(doc)).not.toContain('"tag"');
  });
});
