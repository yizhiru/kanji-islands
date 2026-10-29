import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Dices,
  Eye,
  EyeOff,
  GitBranch,
  Redo2,
  RotateCcw,
  Search,
  Undo2,
  WifiOff,
  X,
} from 'lucide-react';
import type { Dataset, PackedDataset, Filter, Network, Scope } from './core/types';
import { MAX_WORDS, expandNetwork, graphOf, removeExpansion, startNetwork } from './core/network';
import {
  entriesFor,
  decodeDataset,
  kanjiOf,
  normalize,
  referencesFor,
  Vocabulary,
  wordId,
} from './core/vocabulary';
import { NetworkCanvas } from './components/NetworkCanvas';
import { WordDetails } from './components/WordDetails';

interface Timeline {
  present: Network;
  past: Network[];
  future: Network[];
}
const scopeNames: Record<Scope, string> = {
  all: '标准词库',
  textbook: '标日',
  beginner: '初级',
  intermediate: '中级',
};

function About({ vocab, onClose }: { vocab: Vocabulary; onClose: () => void }) {
  const [notices, setNotices] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="about-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <span className="eyebrow">关于汉字岛</span>
        <button className="icon-button" aria-label="关闭词库说明" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <h2>一词出发，一字相连。</h2>
      <p>词汇成岛，汉字相连。点击词中的汉字，探索关联词。</p>
      <div className="about-stat">
        <strong>{vocab.data.metadata.entryCount.toLocaleString()}</strong>
        <span>已整合词条</span>
        <strong>{vocab.words.size.toLocaleString()}</strong>
        <span>不同词形</span>
      </div>
      <p>
        <b>不会保存学习记录。</b>{' '}
        当前词网只存在于这个窗口中，刷新或关闭后清空。查词与探索无需网络；打开外部词典时需联网。
      </p>
      <p>
        悬停词卡查看平假名读音，选中后在详情中显示。片假名单词保留原词形。课次中的 <b>※</b>{' '}
        表示讲解或练习中的生词，
        <b>▼</b> 表示关联词语，无符号表示课文／正文中的生词。数字表示初次出现的课次。
      </p>
      <p>
        主库为完整 JMdict / Jitendex 快照，含{' '}
        {vocab.data.metadata.dictionaryEntries?.toLocaleString()} 个词典条目， 同时保留{' '}
        {vocab.data.metadata.textbookEntries?.toLocaleString()} 条已核对的标日词条与课次。 另有{' '}
        {vocab.data.metadata.pendingGroups.toLocaleString()} 组教材匹配待核对，不自动附加课次。
        “未匹配标日课次”不代表教材中一定没有该词。自定义起点可参与共字连接。
      </p>
      <p>
        假名来自词典。朗读使用本机日语合成语音，不作为真人发音或音调标准；多读音可分别播放。Jisho
        词典在浏览器中打开，真人音频以其收录为准。
      </p>
      <p>
        中文：{vocab.data.metadata.chineseVersion}。英文：{vocab.data.metadata.englishVersion}
        。中文版尚未全部人工核验；普通多义词保留词典义项。
      </p>
      <p>
        词典派生数据：CC BY-SA 4.0。署名：greyindex、Stephen Kraus / Jitendex、EDRDG / JMdict
        及上游来源。应用代码：MIT。教材 PDF 是独立来源材料。
      </p>
      <button
        className="secondary-button"
        onClick={async () => {
          try {
            const response = await fetch(`${import.meta.env.BASE_URL}dictionary-notices.txt`);
            if (!response.ok) throw new Error();
            setNotices(await response.text());
          } catch {
            setNotices('许可文件读取失败，请检查应用资源。');
          }
        }}
      >
        查看完整署名与许可 <ArrowRight size={15} />
      </button>
      {notices && <pre className="license-text">{notices}</pre>}
    </dialog>
  );
}

function Explorer({ vocab }: { vocab: Vocabulary }) {
  const [filter, setFilter] = useState<Filter>({ scope: 'all', lesson: '' });
  const [timeline, setTimeline] = useState<Timeline>(() => ({
    present: startNetwork(wordId('発表')),
    past: [],
    future: [],
  }));
  const network = timeline.present;
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [showReading, setShowReading] = useState(false);
  const [about, setAbout] = useState(false);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => vocab.search(query, filter), [vocab, query, filter]);
  const graph = graphOf(network, vocab);
  const scopeWords = vocab.inScope(filter).length;
  const commit = (next: Network) =>
    setTimeline((current) =>
      JSON.stringify(next) === JSON.stringify(current.present)
        ? current
        : { present: next, past: [...current.past, current.present].slice(-60), future: [] },
    );
  const notify = (value: string) => setMessage(value);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const start = (value: string) => {
    const text = normalize(value);
    if (!text) {
      input.current?.focus();
      return;
    }
    if ([...text].length > 32) {
      notify('起点请控制在 32 个字符以内。');
      return;
    }
    let id = wordId(text);
    if (!vocab.words.has(id) && !kanjiOf(text).length) {
      const matches = vocab.search(text, filter);
      if (matches.length) id = matches[0].id;
      else {
        notify('这个输入没有可连接的汉字。请从搜索建议选择词汇，或输入含汉字的日语词。');
        return;
      }
    }
    commit(startNetwork(id));
    setQuery('');
    setFocused(false);
    setSuggestionIndex(-1);
  };
  const expand = (kanji: string, base = network) => {
    if (base.words.length >= MAX_WORDS) {
      notify(`当前网络已有 ${MAX_WORDS} 个词，可以从新词重新开始探索。`);
      return;
    }
    const next = expandNetwork(base, kanji, vocab, filter);
    if (next === base) {
      notify(`当前范围没有其他含「${kanji}」的词。`);
      return;
    }
    commit(next);
    if (next.words.length === base.words.length)
      notify(`含「${kanji}」的关联词已全部在当前网络中。`);
  };
  const select = (id: string) => {
    if (network.words.includes(id)) {
      commit({ ...network, selected: id });
      return;
    }
    if (network.words.length >= MAX_WORDS) {
      notify('当前词网已达上限，请从新词开始探索。');
      return;
    }
    const shared = vocab.get(network.selected).kanji.find((k) => vocab.get(id).kanji.includes(k));
    if (!shared) return;
    commit({
      ...network,
      selected: id,
      words: [...network.words, id],
      expansions: network.expansions.some((e) => e.kanji === shared)
        ? network.expansions
        : [...network.expansions, { kanji: shared, parent: network.selected, limit: 0 }],
    });
  };
  const changeFilter = (next: Filter) => {
    setFilter(next);
    setTimeline({ present: startNetwork(network.selected), past: [], future: [] });
  };
  return (
    <div className="app-shell">
      <header className="site-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            start('発表');
          }}
          aria-label="汉字岛首页"
        >
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          <strong>汉字岛</strong>
        </a>
        <div className="header-actions">
          <button className="about-button" onClick={() => setAbout(true)}>
            <BookOpen size={16} />
            词库与来源
          </button>
        </div>
      </header>
      <main>
        <section className="intro-bar">
          <h1>词汇成岛，汉字相连。</h1>
        </section>
        <div className="search-and-filter">
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              start(focused && suggestionIndex >= 0 ? suggestions[suggestionIndex].text : query);
            }}
          >
            <Search size={19} />
            <label className="sr-only" htmlFor="word-search">
              输入起始词
            </label>
            <input
              id="word-search"
              ref={input}
              value={query}
              placeholder="搜索单词、假名或释义…"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              role="combobox"
              aria-autocomplete="list"
              aria-controls="search-suggestions"
              aria-expanded={focused && suggestions.length > 0}
              aria-activedescendant={
                suggestionIndex >= 0 ? `suggestion-${suggestionIndex}` : undefined
              }
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestionIndex(-1);
                setFocused(true);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() =>
                setTimeout(() => {
                  if (document.activeElement !== input.current) setFocused(false);
                }, 150)
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFocused(false);
                  setSuggestionIndex(-1);
                }
                if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
                  e.preventDefault();
                  setFocused(true);
                  setSuggestionIndex(
                    (i) =>
                      (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                      suggestions.length,
                  );
                }
              }}
            />
            <kbd>⌘ K</kbd>
            <button className="primary-button" type="submit">
              开始探索 <ArrowRight size={16} />
            </button>
            {focused && suggestions.length > 0 && (
              <div
                className="search-suggestions"
                id="search-suggestions"
                role="listbox"
                aria-label="词库搜索结果"
              >
                {suggestions.map((word, i) => (
                  <button
                    type="button"
                    key={word.id}
                    id={`suggestion-${i}`}
                    role="option"
                    aria-selected={i === suggestionIndex}
                    className={i === suggestionIndex ? 'active' : ''}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => start(word.text)}
                  >
                    <span lang="ja">{word.text}</span>
                    <small>
                      {showReading && entriesFor(word, filter)[0]?.reading_hiragana}{' '}
                      <span>{referencesFor(entriesFor(word, filter), filter)}</span>
                    </small>
                    <ArrowRight size={15} />
                  </button>
                ))}
              </div>
            )}
          </form>
          <button
            className="random-button"
            onClick={() => {
              const word = vocab.random(filter);
              if (word) start(word.text);
              else notify('这个范围暂时没有可连接的词，请更换课次。');
            }}
          >
            <Dices size={18} />
            随机起点
          </button>
          <div className="scope-control" aria-label="选择词库范围">
            {(['all', 'textbook'] as Scope[]).map((scope) => (
              <button
                key={scope}
                aria-pressed={filter.scope === scope}
                className={filter.scope === scope ? 'active' : ''}
                onClick={() => changeFilter({ scope, lesson: '' })}
              >
                {scopeNames[scope]}
              </button>
            ))}
          </div>
        </div>
        <div className="workspace">
          <section className="graph-panel" aria-label="探索工作区">
            <div className="workspace-toolbar">
              <div className="network-title">
                <GitBranch size={17} />
                <strong>当前词网</strong>
                <span className="network-stat" data-testid="network-stat">
                  {network.words.length} 个词 <i /> {network.expansions.length} 个汉字 <i />{' '}
                  {graph.edges.length} 条连接
                </span>
              </div>
              <div className="toolbar-actions">
                <button
                  className="icon-button"
                  title="撤回上一步"
                  aria-label="撤回上一步"
                  disabled={!timeline.past.length}
                  onClick={() =>
                    setTimeline((t) => ({
                      present: t.past.at(-1)!,
                      past: t.past.slice(0, -1),
                      future: [t.present, ...t.future],
                    }))
                  }
                >
                  <Undo2 size={16} />
                </button>
                <button
                  className="icon-button"
                  title="重做"
                  aria-label="重做"
                  disabled={!timeline.future.length}
                  onClick={() =>
                    setTimeline((t) => ({
                      present: t.future[0],
                      past: [...t.past, t.present],
                      future: t.future.slice(1),
                    }))
                  }
                >
                  <Redo2 size={16} />
                </button>
                <span className="toolbar-divider" />
                <button
                  className={`reading-toggle ${showReading ? 'active' : ''}`}
                  aria-pressed={showReading}
                  title="常显词卡读音"
                  onClick={() => setShowReading((v) => !v)}
                >
                  {showReading ? <EyeOff size={15} /> : <Eye size={15} />}
                  {showReading ? '隐藏读音' : '显示读音'}
                </button>
                <button
                  className="icon-button"
                  title="重置当前词网"
                  aria-label="重置当前词网"
                  onClick={() => commit(startNetwork(network.root))}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>
            <NetworkCanvas
              vocab={vocab}
              network={network}
              filter={filter}
              showReading={showReading}
              onSelect={select}
              onExpand={expand}
              onHub={(kanji) => {
                const parent = network.expansions.find((e) => e.kanji === kanji)!.parent;
                expand(kanji, { ...network, selected: parent });
              }}
              onNotify={notify}
              onRemoveHub={(kanji) => commit(removeExpansion(network, kanji, vocab))}
            />
          </section>
          <WordDetails
            vocab={vocab}
            network={network}
            filter={filter}
            onExpand={expand}
            onSelect={select}
            onNotify={notify}
          />
        </div>
        <footer className="page-footer">
          <div>
            <span className="live-dot" />
            <span>
              {scopeNames[filter.scope]} · {scopeWords.toLocaleString()} 个词形
            </span>
            <span className="footer-separator">/</span>
            <label>
              课次{' '}
              <select
                aria-label="筛选课次"
                value={filter.lesson}
                onChange={(e) => changeFilter({ ...filter, lesson: e.target.value })}
              >
                <option value="">全部课次</option>
                {(['初级', '中级'] as const).map((level) => (
                  <optgroup label={level} key={level}>
                    {Array.from({ length: level === '初级' ? 48 : 32 }, (_, i) => (
                      <option key={i} value={`${level}:${i + 1}`}>
                        {level} · 第 {i + 1} 课
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
        </footer>
      </main>
      <div className={`toast ${message ? 'visible' : ''}`} role="status" aria-live="polite">
        {message && (
          <>
            <Check size={16} />
            {message}
          </>
        )}
      </div>
      {about && <About vocab={vocab} onClose={() => setAbout(false)} />}
    </div>
  );
}

export default function App() {
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch(`${import.meta.env.BASE_URL}vocabulary.json`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`无法读取本地词库（${response.status}）`);
        return response.json() as Promise<Dataset | PackedDataset>;
      })
      .then((data) => setVocab(new Vocabulary(decodeDataset(data))))
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [attempt]);
  if (error)
    return (
      <div className="loading-screen">
        <WifiOff size={38} />
        <h1>词库还没有准备好</h1>
        <p>{error}</p>
        <p>在项目中执行 npm run data:build 后重试。</p>
        <button className="primary-button" onClick={() => setAttempt((n) => n + 1)}>
          重新读取
        </button>
      </div>
    );
  if (!vocab)
    return (
      <div className="loading-screen" role="status">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <h1>汉字岛</h1>
        <p>正在铺开本地词库…</p>
        <span className="loading-line" />
      </div>
    );
  return <Explorer vocab={vocab} />;
}
