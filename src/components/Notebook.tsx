import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { MAX_BACKUP_BYTES, parseNotebookBackup, serializeNotebook } from '../core/notebook';
import type { Vocabulary } from '../core/vocabulary';

export function Notebook({
  vocab,
  words,
  onRemove,
  onImport,
  onSelect,
  onClose,
}: {
  vocab: Vocabulary;
  words: ReadonlySet<string>;
  onRemove: (id: string) => void;
  onImport: (ids: string[]) => number;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const importBackup = async (file: File) => {
    setImporting(true);
    setFeedback(undefined);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 10 MB，请检查所选文件。');
      const added = onImport(parseNotebookBackup(await file.text()));
      setFeedback({ text: added ? `已导入 ${added} 个生词。` : '没有新增生词。' });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : '无法导入备份，请重试。',
        error: true,
      });
    } finally {
      setImporting(false);
    }
  };
  const exportBackup = () => {
    const url = URL.createObjectURL(
      new Blob([serializeNotebook(words)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kanji-islands-notebook.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
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
      <div className="notebook-backup-actions">
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="选择生词备份文件"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importBackup(file);
          }}
        />
        <button
          type="button"
          className="text-button"
          disabled={importing}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={15} aria-hidden="true" /> {importing ? '正在导入…' : '导入生词'}
        </button>
        <button type="button" className="text-button" disabled={!words.size} onClick={exportBackup}>
          <Download size={15} aria-hidden="true" /> 导出生词
        </button>
      </div>
      {feedback && (
        <p className="notebook-backup-feedback" role={feedback.error ? 'alert' : 'status'}>
          {feedback.text}
        </p>
      )}
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
