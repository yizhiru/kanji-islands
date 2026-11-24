import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Download, Upload, X } from 'lucide-react';
import { n2Book as n2 } from '../core/n2';
import { useNotebookPracticeBook } from '../core/notebook';
import {
  deletePracticeBook,
  loadPracticeBooks,
  loadRemovedCards,
  parsePracticeCsv,
  restorePracticeCards,
  savePracticeBook,
  setCardRemoved,
  type PracticeBook,
  type PracticeCard,
} from '../core/practiceBooks';
import type { PronunciationController } from '../core/usePronunciation';
import { type Vocabulary, wordId } from '../core/vocabulary';
import { NotebookPractice } from './NotebookPractice';

const GROUP_SIZE = 20;
const groupKey = (id: string) => `kanji-islands.practice-group.${id}`;

// Imported rows are immutable. Shikken's ranks can change between editions.
function cardKey(book: PracticeBook, card: PracticeCard, row: number) {
  return book.id === n2.id ? JSON.stringify([card.word, card.reading]) : String(row);
}

function lastGroup(book: PracticeBook) {
  try {
    const group = Number(localStorage.getItem(groupKey(book.id)));
    if (Number.isInteger(group) && group >= 0 && group * GROUP_SIZE < book.cards.length)
      return group;
  } catch {
    // Practice also works without saved progress.
  }
  return 0;
}

interface Props {
  words: ReadonlySet<string>;
  setSaved: (id: string, saved: boolean) => Promise<boolean>;
  vocab: Vocabulary;
  speech: PronunciationController;
  message: string;
  onNotify: (message: string) => void;
  onClose: () => void;
}

export default function PracticeLibrary({
  words,
  setSaved,
  vocab,
  speech,
  message,
  onNotify,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<PracticeBook[]>([]);
  const [removals, setRemovals] = useState(new Map<string, Set<string>>());
  const notebook = useNotebookPracticeBook(words, vocab);
  const choices = [notebook, n2, ...books];
  const [selected, setSelected] = useState(words.size ? notebook.id : n2.id);
  const book = choices.find((item) => item.id === selected) ?? n2;
  const personal = book.id === notebook.id;
  const [group, setGroup] = useState(() => (personal ? 0 : lastGroup(n2)));
  const catalog = useMemo(() => {
    const result = new Map<string, { groups: PracticeCard[][]; count: number }>();
    for (const source of [n2, ...books]) {
      const excluded = removals.get(source.id);
      const groups: PracticeCard[][] = [];
      let count = 0;
      for (let start = 0; start < source.cards.length; start += GROUP_SIZE) {
        const cards = source.cards
          .slice(start, start + GROUP_SIZE)
          .filter((card, i) => !excluded?.has(cardKey(source, card, start + i)));
        groups.push(cards);
        count += cards.length;
      }
      result.set(source.id, { groups, count });
    }
    return result;
  }, [books, removals]);
  const deck = catalog.get(book.id);
  const cards = deck ? (deck.groups[group] ?? []) : book.cards;
  const nextGroup = deck?.groups.findIndex((items, i) => i > group && items.length > 0) ?? -1;
  const [practicing, setPracticing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    let active = true;
    Promise.all([loadPracticeBooks(), loadRemovedCards()])
      .then(([loaded, removed]) => {
        if (!active) return;
        const byBook = new Map<string, Set<string>>();
        for (const { bookId, key } of removed) {
          if (!byBook.has(bookId)) byBook.set(bookId, new Set());
          byBook.get(bookId)!.add(key);
        }
        setRemovals(byBook);
        setBooks(loaded);
      })
      .catch(() => {
        if (active) setFeedback('无法读取本机的词本和练习记录，请重新打开词本练习。');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      element.close();
    };
  }, []);

  function selectBook(next: PracticeBook) {
    setSelected(next.id);
    setGroup(next.id === notebook.id ? 0 : lastGroup(next));
    setConfirmDelete(false);
    setFeedback('');
  }

  async function changeCardRemoval(card: PracticeCard, removed: boolean) {
    if (personal) return setSaved(wordId(card.word), !removed);
    const key = cardKey(book, card, book.cards.indexOf(card));
    await setCardRemoved(book.id, key, removed);
    setRemovals((current) => {
      const updated = new Set(current.get(book.id));
      if (removed) updated.add(key);
      else updated.delete(key);
      return new Map(current).set(book.id, updated);
    });
    return true;
  }

  async function restoreBook() {
    setBusy(true);
    try {
      await restorePracticeCards(book.id);
      setRemovals((current) => {
        const next = new Map(current);
        next.delete(book.id);
        return next;
      });
      setFeedback('');
    } catch {
      setFeedback('恢复词条失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  async function importBook(file: File) {
    setBusy(true);
    setFeedback('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 UTF-8 CSV 文件。');
      const cards = parsePracticeCsv(await file.text());
      const base = file.name.replace(/\.csv$/i, '').trim() || '自定义词本';
      const names = new Set(choices.map((item) => item.name));
      let name = base;
      for (let i = 2; names.has(name); i++) name = `${base}（${i}）`;
      const imported = { id: crypto.randomUUID(), name, cards };
      await savePracticeBook(imported);
      setBooks((current) => [...current, imported]);
      selectBook(imported);
    } catch (error) {
      setFeedback(
        error instanceof Error && !(error instanceof DOMException)
          ? error.message
          : '词本保存失败，请检查本机存储空间后重试。',
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeBook() {
    setBusy(true);
    try {
      await deletePracticeBook(book.id);
      setBooks((current) => current.filter((item) => item.id !== book.id));
      selectBook(n2);
      try {
        localStorage.removeItem(groupKey(book.id));
      } catch {
        /* Optional progress. */
      }
    } catch {
      setFeedback('词本删除失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  function start(position: number) {
    if (!personal) {
      try {
        localStorage.setItem(groupKey(book.id), String(position));
      } catch {
        /* Optional progress. */
      }
    }
    onNotify('');
    speech.stop();
    setGroup(position);
    setPracticing(true);
  }

  return (
    <dialog
      ref={dialog}
      className="settings-dialog library-dialog"
      aria-labelledby="library-title"
      onCancel={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id="library-title">词本练习</h2>
        <button className="icon-button" aria-label="关闭词本练习" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <label className="library-field">
        选择词本
        <select
          value={book.id}
          disabled={busy}
          onChange={(event) =>
            selectBook(choices.find((item) => item.id === event.target.value) ?? n2)
          }
        >
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {(catalog.get(item.id)?.count ?? item.cards.length).toLocaleString()} 条
            </option>
          ))}
        </select>
      </label>
      {book.id === n2.id && (
        <p className="library-note">
          <a
            href="https://shikken.app/en/jlpt-n2-vocabulary-list/"
            target="_blank"
            rel="noreferrer"
          >
            Shikken N2 词表
          </a>{' '}
          按词频排列。词形、读音和英文释义来自 EDRDG / JMdict，采用 CC BY-SA 4.0 许可。
        </p>
      )}
      {!deck ? (
        <p className="library-note">
          {words.size
            ? '随机练习已收藏的生词，熟悉后可以移出。'
            : '还没有生词。在单词详情中点击「加入生词本」，就能在这里练习。'}
        </p>
      ) : (
        <>
          <label className="library-field">
            练习分组
            <select
              disabled={busy}
              value={group}
              onChange={(event) => setGroup(Number(event.target.value))}
            >
              {deck.groups.map((items, i) => (
                <option key={i} value={i}>
                  第 {i + 1} 组 · 词条 {i * GROUP_SIZE + 1}–
                  {Math.min((i + 1) * GROUP_SIZE, book.cards.length)}
                  {items.length < Math.min(GROUP_SIZE, book.cards.length - i * GROUP_SIZE) &&
                    `（剩余 ${items.length} 条）`}
                </option>
              ))}
            </select>
          </label>
          <p className="library-note">
            {cards.length
              ? '每组最多 20 条，本轮只练所选范围内的词，顺序随机。'
              : deck.count
                ? '这组的词已全部移除，请选另一组继续练习。'
                : '这个词本的词已全部移除。'}
          </p>
          {!deck.count && (
            <button className="secondary-button" disabled={busy} onClick={() => void restoreBook()}>
              恢复全部 {book.cards.length} 条词汇
            </button>
          )}
        </>
      )}
      <button
        className="primary-button library-start"
        disabled={busy || !cards.length}
        onClick={() => start(group)}
      >
        开始练习 <ArrowRight size={16} />
      </button>
      <section className="library-import" aria-label="自定义词本">
        <h3>自定义词本</h3>
        <p className="library-note">
          用 UTF-8 CSV 导入自己的单词。第一行写 <code>word,reading,meaning</code>
          ，后两列可省略。词本以文件名命名，保存在本机。
        </p>
        <div className="library-tools">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            aria-label="选择练习词本文件"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void importBook(file);
            }}
          />
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} /> 导入 CSV 词本
          </button>
          <a
            className="text-button"
            href={`${import.meta.env.BASE_URL}practice-example.csv`}
            download="练习词本示例.csv"
          >
            <Download size={15} /> 下载示例
          </a>
          {!personal && book.id !== n2.id && !confirmDelete && (
            <button className="text-button" disabled={busy} onClick={() => setConfirmDelete(true)}>
              删除此词本
            </button>
          )}
        </div>
        {confirmDelete && (
          <div className="library-delete">
            <p>从本机删除「{book.name}」？</p>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
            <button className="text-button" disabled={busy} onClick={() => void removeBook()}>
              确认删除
            </button>
          </div>
        )}
        {feedback && (
          <p role="alert" className="library-error">
            {feedback}
          </p>
        )}
      </section>
      {practicing && (
        <NotebookPractice
          key={`${book.id}/${group}`}
          title={book.name}
          group={personal ? undefined : group + 1}
          cards={cards}
          onSetRemoved={changeCardRemoval}
          vocab={vocab}
          speech={speech}
          message={message}
          onNotify={onNotify}
          onClose={() => setPracticing(false)}
          onNextGroup={nextGroup >= 0 ? () => start(nextGroup) : undefined}
        />
      )}
    </dialog>
  );
}
