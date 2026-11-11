import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PronunciationController } from '../core/usePronunciation';
import type { Entry } from '../core/types';
import { hasLanguage, lookupDictionaries } from '../core/dictionaries/storage';
import type { DictionaryInfo, DictionaryMatch } from '../core/dictionaries/types';

function ImportedLanguage({
  matches,
  language,
  speech,
}: {
  matches: DictionaryMatch[];
  language: 'zh' | 'ja';
  speech: PronunciationController;
}) {
  return (
    <div className="imported-definitions">
      {matches.map((match) => (
        <div className="imported-entry" key={`${match.dictionary.id}:${match.entry.id}`}>
          <p className="imported-heading" lang="ja">
            {match.entry.heading}
          </p>
          {match.via && <p className="sense-note">{match.via}；以下保留目标词条的解释和限制。</p>}
          {match.entry.blocks
            .filter((b) => b[language] && (language === 'ja' || b.kind !== 'example'))
            .map((block, i, blocks) => (
              <div className={`imported-block imported-${block.kind}`} key={i}>
                {block.context && (i === 0 || block.context !== blocks[i - 1].context) && (
                  <p className="imported-context" lang="ja">
                    {block.context}
                  </p>
                )}
                <p>
                  {block.kind === 'definition' && block.label && <b>{block.label} </b>}
                  {block[language]}
                  {language === 'ja' && block.kind === 'example' && (
                    <button
                      className="text-button example-play"
                      aria-label={`朗读例句 ${block.ja}`}
                      title={speech.canPlay ? '朗读例句' : '请在设置中查看朗读方式'}
                      disabled={!speech.canPlay}
                      onClick={() => speech.play(block.ja)}
                    >
                      <Volume2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </p>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

export function EntryMeanings({
  word,
  entry,
  dictionaries,
  speech,
}: {
  word: string;
  entry: Entry;
  dictionaries: DictionaryInfo[];
  speech: PronunciationController;
}) {
  const queryKey = `${entry.id}:${word}:${dictionaries.map((d) => `${d.id}:${d.enabled}`).join(',')}`;
  const [state, setState] = useState<{ key: string; matches: DictionaryMatch[]; error?: string }>({
    key: '',
    matches: [],
  });
  useEffect(() => {
    let active = true;
    if (!dictionaries.some((d) => d.enabled)) return;
    lookupDictionaries(word, entry, dictionaries)
      .then((matches) => {
        if (active) setState({ key: queryKey, matches });
      })
      .catch(() => {
        if (active)
          setState({ key: queryKey, matches: [], error: '用户词典读取失败，暂用内置释义。' });
      });
    return () => {
      active = false;
    };
  }, [entry, word, dictionaries, queryKey]);
  const matches = state.key === queryKey ? state.matches : [];
  const choose = (language: 'zh' | 'ja') => {
    const first = matches.find((m) => hasLanguage(m.entry, language));
    return first
      ? matches.filter(
          (m) => m.dictionary.id === first.dictionary.id && hasLanguage(m.entry, language),
        )
      : [];
  };
  const chinese = choose('zh'),
    japanese = choose('ja');
  return (
    <>
      {state.key === queryKey && state.error && (
        <p role="status" className="sense-note">
          {state.error}
        </p>
      )}
      <details className="meaning-language" lang="zh-CN" open>
        <summary>
          <h4>中文释义</h4>
          <span className="definition-source" lang="zh-CN">
            {chinese.length ? chinese[0].dictionary.title : 'Jitendex 中文版'}
          </span>
        </summary>
        {chinese.length ? (
          <ImportedLanguage matches={chinese} language="zh" speech={speech} />
        ) : (
          <>
            <ol className="sense-list">
              {entry.senses.map((sense) => (
                <li key={sense.id}>
                  <div className="chinese-gloss">
                    {sense.zh.join('；') || '暂无可靠对应的中文释义，请参阅英文。'}
                  </div>
                  {sense.notes_zh.length > 0 && (
                    <div className="sense-note">{sense.notes_zh.join('；')}</div>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </details>
      {japanese.length > 0 && (
        <details className="meaning-language" lang="ja" open>
          <summary>
            <h4>日文释义</h4>
            <span className="definition-source" lang="zh-CN">
              {japanese[0].dictionary.title}
            </span>
          </summary>
          <ImportedLanguage matches={japanese} language="ja" speech={speech} />
        </details>
      )}
      <details className="meaning-language" lang="en" open>
        <summary>
          <h4>英文释义</h4>
          <span className="definition-source" lang="zh-CN">
            Jitendex / JMdict
          </span>
        </summary>
        <ol className="sense-list">
          {entry.senses.map((sense) => (
            <li key={sense.id}>
              <div className="english-gloss">{sense.en.join('; ')}</div>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
