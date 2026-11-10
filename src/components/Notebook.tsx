import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Vocabulary } from '../core/vocabulary';

export function Notebook({
  vocab,
  words,
  onRemove,
  onSelect,
  onClose,
}: {
  vocab: Vocabulary;
  words: ReadonlySet<string>;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const matches = [...words]
    .reverse()
    .map((id) => vocab.get(id))
    .filter((word) =>
      [
        word.text,
        ...word.entries.flatMap((entry) => [
          entry.reading_hiragana,
          ...entry.meanings_zh,
          ...entry.meanings_en,
        ]),
      ].some((text) => text.toLowerCase().includes(query.trim().toLowerCase())),
    );
  return (
    <dialog
      ref={dialog}
      className="settings-dialog notebook-dialog"
      aria-label="生词本"
      onCancel={onClose}
    >
      <div className="modal-heading">
        <h2>生词本 · {words.size}</h2>
        <button className="icon-button" aria-label="关闭生词本" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <p>保存在本机。可在词汇详情中添加生词，点击单词开始探索。</p>
      <input
        className="notebook-search"
        aria-label="搜索生词本"
        placeholder="搜索单词、假名或释义…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!matches.length && (
        <p>{words.size ? '没有匹配的生词。' : '生词本还是空的，添加一个单词开始积累吧。'}</p>
      )}
      <div className="notebook-list">
        {matches.map((word) => (
          <div className="notebook-row" key={word.id}>
            <button
              className="related-word"
              aria-label={`探索生词${word.text}`}
              onClick={() => onSelect(word.id)}
            >
              <span lang="ja">
                {word.text}
                <small>
                  {[...new Set(word.entries.map((entry) => entry.reading_hiragana))].join(' / ')}
                </small>
              </span>
            </button>
            <button
              className="text-button"
              aria-label={`删除生词${word.text}`}
              onClick={() => onRemove(word.id)}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </dialog>
  );
}
