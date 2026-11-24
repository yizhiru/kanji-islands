import type { Entry } from './types';

// JMdict sense tags, documented at https://www.edrdg.org/jmwsgi/edhelp.py?svc=jmdict
const labels: Record<string, string> = {
  n: '名词',
  'n-pr': '专有名词',
  'n-t': '时间名词',
  'n-adv': '副词性名词',
  'n-pref': '前缀名词',
  'n-suf': '后缀名词',
  pn: '代词',
  num: '数词',
  ctr: '量词',
  'adj-i': '一类形容词',
  'adj-ix': '一类形容词',
  'adj-na': '二类形容词',
  'adj-no': 'の修饰',
  'adj-f': '连体修饰',
  'adj-pn': '连体词',
  'adj-t': 'タル形容词',
  'adj-ku': 'ク活用',
  'adj-shiku': 'シク活用',
  'adj-nari': 'ナリ活用',
  'adj-kari': 'カリ活用',
  adv: '副词',
  'adv-to': '副词',
  conj: '接续词',
  int: '感叹词',
  prt: '助词',
  pref: '前缀',
  suf: '后缀',
  aux: '辅助词',
  'aux-v': '助动词',
  'aux-adj': '补助形容词',
  cop: '系词',
  exp: '短语表达',
  vs: '可接する',
  'vs-i': 'サ变动词',
  'vs-s': 'サ变动词',
  vk: 'カ变动词',
  'vs-c': '古典サ变',
  vn: '古典ナ变',
  vr: '古典ラ变',
  v1: '二类动词',
  'v1-s': '二类动词',
  vz: '二类动词',
  'v-unspec': '动词',
};

const abbreviations: Record<string, string> = {
  名词: '名',
  专有名词: '专名',
  时间名词: '时名',
  副词性名词: '副名',
  前缀名词: '名前缀',
  后缀名词: '名后缀',
  代词: '代',
  数词: '数',
  量词: '量',
  一类动词: '五段',
  二类动词: '一段',
  四段动词: '四段',
  古典二段动词: '二段',
  动词: '动',
  可接する: 'サ变',
  サ变动词: 'サ变',
  カ变动词: 'カ变',
  一类形容词: 'い形',
  二类形容词: 'な形',
  の修饰: 'の',
  连体修饰: '连体',
  连体词: '连体',
  タル形容词: 'タル',
  副词: '副',
  接续词: '接续',
  感叹词: '叹',
  助词: '助',
  辅助词: '辅助',
  助动词: '助动',
  补助形容词: '补形',
  系词: '系',
  短语表达: '短语',
};

const explanations: Record<string, string> = {
  一类动词: '一类动词（五段动词）',
  二类动词: '二类动词（一段动词）',
  サ变动词: '三类动词（サ变动词）',
  カ变动词: '三类动词（カ变动词）',
  可接する: '可接する构成三类动词（サ变动词）',
  一类形容词: '一类形容词（い形容词）',
  二类形容词: '二类形容词（な形容词）',
  の修饰: '可接の修饰名词',
  く形: '一类形容词的く形（副词用法）',
  に形: '二类形容词的に形（副词用法）',
};

function labelFor(tag: string) {
  if (tag.startsWith('v5')) return '一类动词';
  if (tag.startsWith('v4')) return '四段动词';
  if (tag.startsWith('v2')) return '古典二段动词';
  return labels[tag];
}

export function partsOfSpeech(entries: Entry[]) {
  const parts = new Set<string>();
  for (const entry of entries) {
    // These surface forms change the grammatical use of the underlying lemma.
    const form = entry.inflection?.form;
    if (form === 'nominal_sa' || form === 'adverbial_ku' || form === 'adverbial_ni') {
      parts.add(form === 'nominal_sa' ? '名词' : form === 'adverbial_ku' ? 'く形' : 'に形');
      continue;
    }
    for (const sense of entry.senses) {
      const names = sense.pos.map(labelFor).filter(Boolean);
      for (const name of names) parts.add(name);
      if (!names.length && (sense.pos.includes('vi') || sense.pos.includes('vt')))
        parts.add('动词');
    }
  }
  const all = [...parts];
  if (!all.length) return { short: '?', full: '词性未标注' };
  const badges = [...new Set(all.map((name) => abbreviations[name] ?? name))];
  return {
    short: badges.slice(0, 2).join('·') + (badges.length > 2 ? '…' : ''),
    full: all.map((name) => explanations[name] ?? name).join(' · '),
  };
}
