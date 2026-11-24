import { useEffect, useMemo, useState } from 'react';
import { normalize, type Vocabulary, wordId } from './vocabulary';

const BACKUP_FORMAT = 'kanji-islands-notebook';
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export function serializeNotebook(words: ReadonlySet<string>) {
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: 1, words: [...words].map((id) => id.slice('word:'.length)) },
    null,
    2,
  );
}

export function parseNotebookBackup(source: string): string[] {
  let backup;
  try {
    backup = JSON.parse(source.replace(/^\uFEFF/u, ''));
  } catch {
    throw new Error('无法读取备份，请选择生词本导出的 JSON 文件。');
  }
  if (backup?.format !== BACKUP_FORMAT || !Array.isArray(backup.words))
    throw new Error('请选择生词本导出的 JSON 备份。');
  if (backup.version !== 1) throw new Error('此备份版本不受支持，请升级应用后重试。');
  return backup.words.map((word: unknown) => {
    if (typeof word !== 'string' || !normalize(word) || /[\u0000-\u001f\u007f]/u.test(word))
      throw new Error('备份含有无效生词，请检查文件后重试。');
    return wordId(word);
  });
}

const STORAGE_KEY = 'kanji-islands.notebook.v1';

export function useNotebookPracticeBook(words: ReadonlySet<string>, vocab: Vocabulary) {
  return useMemo(
    () => ({
      id: 'notebook',
      name: '我的生词本',
      cards: [...words].map((id) => ({ word: vocab.get(id).text })),
    }),
    [words, vocab],
  );
}

function readWords(): Set<string> {
  const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  if (!Array.isArray(stored)) throw new Error('无效的生词本数据');
  return new Set(
    stored.filter((id): id is string => typeof id === 'string' && id.startsWith('word:')),
  );
}

export function useNotebook(onNotify: (message: string) => void) {
  const [words, setWords] = useState(() => new Set<string>());
  useEffect(() => {
    const refresh = () => {
      try {
        setWords(readWords());
      } catch {
        onNotify('生词本读取失败，请检查本地存储后重试。');
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === STORAGE_KEY || event.key === null))
        refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', refresh);
    refresh();
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', refresh);
    };
  }, [onNotify]);

  async function update(change: (current: Set<string>) => void) {
    try {
      return await navigator.locks.request(STORAGE_KEY, () => {
        const current = readWords();
        const before = current.size;
        change(current);
        if (current.size !== before)
          localStorage.setItem(STORAGE_KEY, JSON.stringify([...current]));
        setWords(current);
        return current.size - before;
      });
    } catch {
      throw new Error('生词本保存失败，请检查本地存储后重试。');
    }
  }
  const setSaved = async (id: string, saved: boolean) => {
    try {
      await update((current) => {
        if (saved) current.add(id);
        else current.delete(id);
      });
      return true;
    } catch (error) {
      onNotify((error as Error).message);
      return false;
    }
  };
  const toggle = (id: string) => setSaved(id, !words.has(id));
  const merge = (imported: string[]) =>
    update((current) => {
      for (const id of imported) current.add(id);
    });
  return { words, toggle, setSaved, merge };
}
