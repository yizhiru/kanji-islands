import { ArrowUpRight, BookOpen, Eye, EyeOff, GitBranch, Plus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { Filter, Network } from '../core/types';
import { BATCH_SIZE, MAX_WORDS } from '../core/network';
import { entriesFor, referencesFor, Vocabulary } from '../core/vocabulary';
import { verbPairsFor } from '../core/verbPairs';
import { EntryMeanings } from './EntryMeanings';
import type { DictionaryInfo } from '../core/dictionaries/types';
import { CopyButton } from './CopyButton';
import { Pronunciation } from './Pronunciation';
import type { PronunciationController } from '../core/usePronunciation';

const formNames: Record<string, string> = {
  te: 'て形',
  polite_nonpast: '礼貌体',
  polite_past: '礼貌体过去式',
  polite_negative: '礼貌体否定式',
  past: '过去式',
  adverbial_ku: 'く形（副词用法）',
  adverbial_ni: 'に形（副词用法）',
  nominal_sa: 'さ形（名词化）',
};
const textbookReferences = (references: string) => references.replace(/初级|中级/g, '标日$&');
interface Props {
  vocab: Vocabulary;
  dictionaries: DictionaryInfo[];
  network: Network;
  filter: Filter;
  onExpand: (k: string) => void;
  onSelect: (id: string) => void;
  onNotify: (message: string) => void;
  speech: PronunciationController;
  notebook: ReadonlySet<string>;
  onToggleNotebook: (id: string) => void;
  relatedSort: 'default' | 'notebook';
  onRelatedSort: (sort: 'default' | 'notebook') => void;
  collapsed: boolean;
}

export function WordDetails({
  vocab,
  dictionaries,
  network,
  filter,
  onExpand,
  onSelect,
  onNotify,
  speech,
  notebook,
  onToggleNotebook,
  relatedSort,
  onRelatedSort,
  collapsed,
}: Props) {
  const [showMeaning, setShowMeaning] = useState(true);
  const referenceHelpId = useId();
  const word = vocab.get(network.selected);
  const entries = word.entries;
  const scopedEntries = entriesFor(word, filter);
  const [chosenKanji, setChosenKanji] = useState('');
  useEffect(() => {
    const latest = network.expansions.at(-1);
    if (latest && word.kanji.includes(latest.kanji)) setChosenKanji(latest.kanji);
  }, [network.expansions]);
  const active = word.kanji.includes(chosenKanji) ? chosenKanji : word.kanji[0];
  const related = active
    ? vocab.related(active, filter, word.id, relatedSort === 'notebook' ? notebook : undefined)
    : [];
  const expansionLimit = network.expansions.find((e) => e.kanji === active)?.limit ?? 0;
  const relatedLimit = Math.max(12, expansionLimit);
  const verbPairs = verbPairsFor(vocab, word, filter);
  const references = textbookReferences(referencesFor(scopedEntries, filter));
  return (
    <aside id="word-details" className="details-panel" aria-label="词汇详情" hidden={collapsed}>
      <div className="details-heading">
        <span className="detail-index">词汇详情</span>
        <CopyButton text={word.text} label="复制单词" onNotify={onNotify} />
      </div>
      <div className="selected-word-block">
        <h2 lang="ja">{word.text}</h2>
        <button
          className="text-button"
          aria-pressed={notebook.has(word.id)}
          onClick={() => onToggleNotebook(word.id)}
        >
          {notebook.has(word.id) ? '移出生词本' : '加入生词本'}
        </button>
        <p className="selected-reading" lang="ja" aria-label="平假名读音">
          {[...new Set(entries.map((e) => e.reading_hiragana))].join(' / ') || '词库中暂无读音'}
        </p>
        <Pronunciation
          word={word.text}
          readings={[...new Set(entries.map((e) => e.reading_hiragana))]}
          onNotify={onNotify}
          speech={speech}
        />
        <div className="word-references">
          <BookOpen size={16} />
          <span>
            {references ||
              (scopedEntries.length
                ? '未匹配标日课次'
                : entries.length
                  ? '该词不在当前筛选范围内'
                  : '自定义起点 · 词库暂未收录')}
          </span>
          {references && (
            <div className="reference-help" key={`${word.id}:${references}`}>
              <button
                className="reference-help-button"
                aria-label="课次符号说明"
                aria-describedby={referenceHelpId}
              >
                ?
              </button>
              <div className="reference-legend" id={referenceHelpId} role="tooltip">
                <p>数字表示该词初次出现的课次。</p>
                <dl>
                  <div>
                    <dt>无符号</dt>
                    <dd>课文／正文中的生词</dd>
                  </div>
                  <div>
                    <dt>※</dt>
                    <dd>讲解或练习中的生词</dd>
                  </div>
                  <div>
                    <dt>▼</dt>
                    <dd>关联词语</dd>
                  </div>
                </dl>
                <p>关联词语也会分别标出其在课文、讲解或练习中初次出现的课次。</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <section className="expand-section">
        <div className="section-title">
          <h3>汉字连接</h3>
          <GitBranch size={15} />
        </div>
        {word.kanji.length ? (
          <div className="kanji-choices">
            {word.kanji.map((k) => {
              const count = vocab.related(k, filter, word.id).length;
              return (
                <button
                  key={k}
                  className={`kanji-choice ${active === k ? 'active' : ''}`}
                  aria-label={`通过${k}展开关联词`}
                  disabled={!count || network.words.length >= MAX_WORDS}
                  onClick={() => {
                    setChosenKanji(k);
                    onExpand(k);
                  }}
                  title={count ? `${count} 个关联词，点击展开` : '当前范围没有其他关联词'}
                >
                  <span lang="ja">{k}</span>
                  <small>{count} 词</small>
                  <Plus size={13} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="small-empty">这个词没有可展开的汉字。可以输入一个含汉字的日语词。</div>
        )}
      </section>
      <section className="meaning-section">
        <div className="section-title">
          <h3>释义</h3>
          <button className="text-button" onClick={() => setShowMeaning((v) => !v)}>
            {showMeaning ? '隐藏释义' : '揭晓释义'}
            {showMeaning ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
        {!entries.length ? (
          <p className="muted">词库中暂无释义，仍可按汉字探索。</p>
        ) : !showMeaning ? (
          <button className="meaning-cover" onClick={() => setShowMeaning(true)}>
            查看释义
          </button>
        ) : (
          entries.map((entry) => (
            <div className="entry-meanings" key={entry.id}>
              {entries.length > 1 && (
                <span className="variant-label">
                  {entry.reading_hiragana} ·{' '}
                  {textbookReferences(referencesFor([entry], filter)) || '未匹配标日课次'}
                </span>
              )}
              {entry.inflection && (
                <div className="inflection-note">
                  <b>{formNames[entry.inflection.form] || entry.inflection.form}</b>
                  <span>
                    原形：{entry.inflection.lemma}（{entry.inflection.lemma_reading_hiragana}）
                  </span>
                  <span>以下为原形释义；实际含义需结合活用。</span>
                </div>
              )}
              <EntryMeanings word={word.text} entry={entry} dictionaries={dictionaries} />
            </div>
          ))
        )}
      </section>
      {verbPairs.length > 0 && (
        <section className="verb-pairs-section">
          <div className="section-title">
            <h3>自动词／他动词对应</h3>
          </div>
          <p className="muted">
            自动词：事物自身的变化；他动词：对事物施加动作。配对按具体词义使用。
          </p>
          {verbPairs.map((pair) => (
            <div className="verb-pair" key={`${pair.auto.id}:${pair.transitive.id}`}>
              {(
                [
                  ['自动词', pair.auto, pair.autoReading],
                  ['他动词', pair.transitive, pair.transitiveReading],
                ] as const
              ).map(([label, item, reading]) => (
                <button
                  key={label}
                  className="related-word"
                  onClick={() => onSelect(item.id)}
                  aria-label={`查看${label}${item.text}`}
                >
                  <small>{label}</small>
                  <span lang="ja">
                    {item.text}（{reading}）
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          ))}
        </section>
      )}
      <section className="related-section">
        <div className="section-title">
          <h3>含「{active || '—'}」的关联词</h3>
          <span className="count-label">{related.length}</span>
        </div>
        <label className="related-sort">
          候选排序{' '}
          <select
            aria-label="候选单词排序"
            value={relatedSort}
            onChange={(event) => onRelatedSort(event.target.value as 'default' | 'notebook')}
          >
            <option value="default">默认排序</option>
            <option value="notebook">生词优先</option>
          </select>
        </label>
        {word.kanji.length > 1 && (
          <div className="character-tabs" aria-label="查看其他汉字的候选">
            {word.kanji.map((k) => (
              <button
                key={k}
                className={active === k ? 'active' : ''}
                onClick={() => setChosenKanji(k)}
              >
                {k}
              </button>
            ))}
          </div>
        )}
        {related.length ? (
          <>
            <div className="related-list">
              {related.slice(0, relatedLimit).map((item) => (
                <button
                  key={item.id}
                  className="related-word"
                  onClick={() => onSelect(item.id)}
                  aria-label={`查看关联词${item.text}`}
                >
                  <span lang="ja">{item.text}</span>
                  <small>
                    {notebook.has(item.id) && '生词 · '}
                    {network.words.includes(item.id) ? '已在网络' : '加入网络'}
                  </small>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
            <button
              className="expand-more"
              onClick={() => onExpand(active)}
              disabled={network.words.length >= MAX_WORDS || expansionLimit >= related.length}
            >
              <Plus size={14} />
              {network.expansions.some((e) => e.kanji === active) ? '继续展开' : '展开'}「{active}
              」的关联词 <small>每次最多 {BATCH_SIZE} 个</small>
            </button>
          </>
        ) : (
          <p className="muted">当前范围没有其他共用汉字的词，可以试试标准词库。</p>
        )}
      </section>
    </aside>
  );
}
