import { Unzip, UnzipInflate } from 'fflate';
import { hiragana, normalize } from '../vocabulary';
import type { DictionaryBlock, DictionaryEntry, ParsedDictionary } from './types';

const MAX_ZIP = 50 * 1024 * 1024;
const MAX_EXPANDED = 350 * 1024 * 1024;
const MAX_FILE = 32 * 1024 * 1024;
const MAX_TERMS = 300_000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const kana = /^[ぁ-ゖァ-ヺー]+$/u;
type Node = string | Node[] | { [key: string]: unknown };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const content = (n: Record<string, unknown>) => n.content as Node;
const kind = (n: Record<string, unknown>) =>
  record(n.data) && typeof n.data.class === 'string' ? n.data.class : '';
function text(n: unknown): string {
  if (typeof n === 'string') return n;
  if (Array.isArray(n)) return n.map(text).join('');
  return record(n) ? text(n.content) : '';
}
function* walk(n: Node, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 40) throw new Error('词条结构过深。');
  if (Array.isArray(n)) {
    for (const child of n) yield* walk(child, depth + 1);
  } else if (record(n)) {
    yield n;
    if (n.content !== undefined) yield* walk(content(n), depth + 1);
  }
}
function split(
  n: Node,
  defaultLanguage: string,
  language = defaultLanguage,
): Pick<DictionaryBlock, 'ja' | 'zh' | 'en'> {
  const result = { ja: '', zh: '', en: '' };
  const visit = (v: Node, lang: string, depth: number) => {
    if (depth > 40) throw new Error('词条结构过深。');
    if (typeof v === 'string') {
      const key = lang.startsWith('zh') ? 'zh' : lang.startsWith('ja') ? 'ja' : 'en';
      result[key] += v;
    } else if (Array.isArray(v)) for (const child of v) visit(child, lang, depth + 1);
    else if (record(v) && !['num', 'type', 'num_circle'].includes(kind(v))) {
      visit(content(v), typeof v.lang === 'string' ? v.lang : lang, depth + 1);
    }
  };
  visit(n, language, 0);
  for (const key of ['ja', 'zh', 'en'] as const)
    result[key] = result[key].trim().replace(/^\/\s*/, '');
  return result;
}
export function parseGlossary(
  glossary: Node[],
  targetLanguage: string,
): Omit<DictionaryEntry, 'id'> {
  const nodes = [...walk(glossary)];
  if (nodes.length > 80_000) throw new Error('单个词条内容过大。');
  // Never interpret imported markup, CSS, links or executable attributes.
  const meikyo = nodes.some((n) => kind(n) === 'mjrhsjcd-entry');
  const defaultLanguage = meikyo || nodes.some((n) => n.lang === 'zh') ? 'ja' : targetLanguage;
  const blocks: DictionaryBlock[] = [];
  let context = '',
    label = '';
  const add = (n: Node, type: DictionaryBlock['kind']) => {
    const pair = split(n, defaultLanguage);
    if (pair.ja || pair.zh || pair.en) {
      const writing = type === 'definition' ? /^〖[^〗]+〗/.exec(pair.ja)?.[0] : undefined;
      if (writing) pair.ja = pair.ja.slice(writing.length).trim();
      blocks.push({
        ...pair,
        kind: type,
        context,
        label: [label, writing].filter(Boolean).join(' '),
      });
    }
  };
  if (meikyo) {
    for (const n of nodes) {
      if (kind(n) === 'def0') {
        context = text(n);
        label = '';
      }
      if (kind(n) === 'def1') {
        const children = Array.isArray(n.content) ? n.content : [];
        const num = children.find((c) => record(c) && kind(c) === 'num');
        label = text(num);
      }
      if (['def2', 'def2_first'].includes(kind(n))) add(n, 'definition');
      if (kind(n) === 'exam') add(n, 'example');
      if (kind(n) === 'def1') {
        const children = Array.isArray(n.content) ? n.content : [];
        // Keep usage, spelling, supplemental and cross-reference notes outside the main definition.
        const notes = children.filter(
          (c) =>
            !(
              record(c) &&
              (['num', 'def2', 'def2_first', 'exam'].includes(kind(c)) || c.tag === 'br')
            ),
        );
        if (notes.length) add(notes, 'note');
      }
    }
  } else {
    for (const item of glossary)
      add(record(item) && item.type === 'structured-content' ? content(item) : item, 'definition');
  }
  return {
    heading: nodes
      .filter((n) => kind(n) === 'head')
      .map(text)
      .join(' / '),
    pos: [...new Set(nodes.filter((n) => kind(n) === 'type').map(text))],
    blocks,
  };
}

// Validate the central directory before inflating. Streaming size limits below also
// bound dishonest headers. Only stored/deflate, non-encrypted, non-ZIP64 input is accepted.
function directory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true))
    throw new Error('不是受支持的完整 ZIP 文件。');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true),
    total = 0;
  if (
    count > 512 ||
    view.getUint16(end + 8, true) !== count ||
    offset + view.getUint32(end + 12, true) !== end
  )
    throw new Error('ZIP 目录不正确或文件过多。');
  const files = new Map<string, { size: number; crc: number }>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error('ZIP 目录损坏。');
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 24, true),
      length = view.getUint16(offset + 28, true);
    const next =
      offset + 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (next > end) throw new Error('ZIP 目录损坏。');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + length));
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > MAX_FILE ||
      size === 0xffffffff ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((p) => p === '..') ||
      files.has(name)
    )
      throw new Error('词典包含不支持或不安全的 ZIP 项目。');
    total += size;
    if (total > MAX_EXPANDED) throw new Error('词典解压后过大（上限 350 MB）。');
    files.set(name, { size, crc: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== end || !files.has('index.json'))
    throw new Error('缺少根目录 index.json，或 ZIP 目录不完整。');
  return files;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function parseYomitan(
  bytes: Uint8Array,
  id: string,
  onProgress: (message: string) => void = () => {},
): ParsedDictionary {
  if (!bytes.length || bytes.length > MAX_ZIP)
    throw new Error('请选择不超过 50 MB 的 Yomitan ZIP 词典。');
  const files = directory(bytes),
    banks: unknown[][] = [];
  let index: Record<string, unknown> | undefined;
  const completed = new Set<string>();
  const unzip = new Unzip((file) => {
    if (file.name !== 'index.json' && !/^term_bank_\d+\.json$/.test(file.name)) return;
    const expected = files.get(file.name);
    if (!expected || completed.has(file.name)) throw new Error('ZIP 文件项目不一致。');
    const chunks: Uint8Array[] = [];
    let size = 0,
      crc = 0xffffffff;
    file.ondata = (error, data, final) => {
      if (error) throw new Error('词典解压失败。');
      size += data.length;
      if (size > expected.size || size > MAX_FILE) throw new Error('ZIP 解压大小与目录不符。');
      for (const value of data) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
      chunks.push(data);
      if (final) {
        if (size !== expected.size || (crc ^ 0xffffffff) >>> 0 !== expected.crc)
          throw new Error('词典 ZIP 校验失败，文件可能损坏。');
        const merged = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        const value: unknown = JSON.parse(decoder.decode(merged));
        if (file.name === 'index.json') {
          if (!record(value)) throw new Error('index.json 格式不正确。');
          index = value;
        } else {
          if (!Array.isArray(value)) throw new Error('词条文件格式不正确。');
          banks.push(value);
        }
        completed.add(file.name);
        onProgress(`已读取 ${completed.size} 个词典文件`);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 16_384)
    unzip.push(bytes.subarray(offset, offset + 16_384), offset + 16_384 >= bytes.length);
  const expectedFiles = [...files.keys()].filter(
    (n) => n === 'index.json' || /^term_bank_\d+\.json$/.test(n),
  );
  if (
    completed.size !== expectedFiles.length ||
    !banks.length ||
    !index ||
    index.format !== 3 ||
    typeof index.title !== 'string' ||
    !index.title.trim() ||
    typeof index.revision !== 'string'
  )
    throw new Error('需要包含词条的 Yomitan v3 词典包。');
  const entries = new Map<string, DictionaryEntry>(),
    terms: ParsedDictionary['terms'] = [];
  const variants = new Map<string, Map<string, string>>();
  const target = typeof index.targetLanguage === 'string' ? index.targetLanguage : 'ja';
  for (const bank of banks) {
    for (const value of bank) {
      if (terms.length >= MAX_TERMS) throw new Error('词条索引超过 300,000 条。');
      if (
        !Array.isArray(value) ||
        value.length !== 8 ||
        typeof value[0] !== 'string' ||
        !value[0] ||
        value[0].length > 256 ||
        typeof value[1] !== 'string' ||
        value[1].length > 256 ||
        !Array.isArray(value[5]) ||
        !Number.isInteger(value[6])
      )
        throw new Error('发现无效的 Yomitan 词条。');
      // sequence=-1 means unsequenced, so it must never merge independent rows.
      const sequence =
        index.sequenced === true && value[6] >= 0 ? String(value[6]) : `row:${terms.length}`;
      // Some dictionaries use the same sequence for spelling-restricted senses.
      // Only deduplicate genuinely identical payloads, never discard variants.
      const signature = JSON.stringify(value[5]);
      const group = variants.get(sequence) ?? new Map<string, string>();
      const key =
        group.get(signature) ?? (group.size ? `${sequence}:variant:${group.size}` : sequence);
      group.set(signature, key);
      variants.set(sequence, group);
      if (!entries.has(key)) {
        const parsed = parseGlossary(value[5], target);
        entries.set(key, { id: key, ...parsed, heading: parsed.heading || value[0] });
      }
      terms.push({
        dictionaryId: id,
        text: normalize(value[0]),
        reading: value[1] ? hiragana(value[1]) : kana.test(value[0]) ? hiragana(value[0]) : '',
        entryId: key,
      });
    }
  }
  if (!terms.length) throw new Error('词典没有可导入的词条。');
  return {
    info: {
      id,
      title: index.title.slice(0, 160),
      revision: index.revision.slice(0, 160),
      enabled: true,
      importedAt: Date.now(),
      termCount: terms.length,
      entryCount: entries.size,
      source: typeof index.url === 'string' ? index.url.slice(0, 500) : '',
    },
    entries: [...entries.values()],
    terms,
  };
}
