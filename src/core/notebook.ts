import { useState } from 'react';

const STORAGE_KEY = 'kanji-islands.notebook.v1';
export function useNotebook(onNotify: (message: string) => void) {
  const [words, setWords] = useState<Set<string>>(() => {
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
  });
  const toggle = (id: string) => {
    const next = new Set(words);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      setWords(next);
    } catch {
      onNotify('生词本保存失败，请检查本地存储空间。');
    }
  };
  return { words, toggle };
}
