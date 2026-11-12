import { useState } from 'react';
import { normalize, wordId } from './vocabulary';

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
function readWords(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === 'string' && id.startsWith('word:'))
        : [],
    );
  } catch {
    return new Set();
  }
}

export function useNotebook(onNotify: (message: string) => void) {
  const [words, setWords] = useState(readWords);
  const save = (next: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      setWords(next);
    } catch {
      throw new Error('生词本保存失败，请检查本地存储空间。');
    }
  };
  const toggle = (id: string) => {
    const next = new Set(words);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      save(next);
    } catch (error) {
      onNotify((error as Error).message);
    }
  };
  const merge = (imported: string[]) => {
    // Read again after the file finishes loading to include recent changes.
    const merged = readWords();
    const before = merged.size;
    for (const id of imported) merged.add(id);
    save(merged);
    return merged.size - before;
  };
  return { words, toggle, merge };
}
