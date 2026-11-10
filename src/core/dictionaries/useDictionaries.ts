import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDictionary, enableDictionary, listDictionaries } from './storage';
import type { DictionaryInfo } from './types';

export function useDictionaries(notify: (message: string) => void) {
  const [dictionaries, setDictionaries] = useState<DictionaryInfo[]>([]);
  const [progress, setProgress] = useState('');
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [changing, setChanging] = useState(false);
  const worker = useRef<Worker | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const rows = await listDictionaries();
    if (mounted.current) setDictionaries(rows);
  }, []);
  useEffect(() => {
    mounted.current = true;
    refresh()
      .catch(() => notify('本地词典存储不可用，内置词典仍可使用。'))
      .finally(() => {
        if (mounted.current) setReady(true);
      });
    return () => {
      mounted.current = false;
      worker.current?.terminate();
    };
  }, [notify, refresh]);
  const importFile = (file: File) => {
    if (worker.current || changing) return;
    setProgress('正在读取词典…');
    setSaving(false);
    let task: Worker;
    try {
      task = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setProgress('');
      notify('当前环境无法启动本地词典导入。');
      return;
    }
    worker.current = task;
    const stop = () => {
      task.terminate();
      worker.current = null;
      setProgress('');
      setSaving(false);
    };
    task.onmessage = async ({ data }) => {
      if (worker.current !== task) return;
      if (data.type === 'progress' || data.type === 'saving') {
        setProgress(data.message);
        setSaving(data.type === 'saving');
      } else if (data.type === 'done') {
        stop();
        try {
          await refresh();
          notify(`已导入「${data.info.title}」`);
        } catch {
          notify('词典已保存，请刷新后查看。');
        }
      } else if (data.type === 'error') {
        stop();
        notify(data.message);
      }
    };
    task.onerror = () => {
      if (worker.current !== task) return;
      stop();
      notify('无法读取词典，请检查 ZIP 格式和本地存储。');
    };
    task.postMessage(file);
  };
  const cancel = () => {
    if (saving) return;
    worker.current?.terminate();
    worker.current = null;
    setProgress('');
    notify('已取消词典导入。');
  };
  const change = async (operation: () => Promise<void>) => {
    if (worker.current || changing) return;
    setChanging(true);
    try {
      await operation();
      await refresh();
    } catch {
      await refresh().catch(() => {});
      notify('词典更改未能保存，请重试。');
    } finally {
      setChanging(false);
    }
  };
  return {
    dictionaries,
    ready,
    progress,
    saving,
    changing,
    importFile,
    cancel,
    toggle: (id: string, enabled: boolean) => {
      if (worker.current || changing) return;
      setDictionaries((rows) => rows.map((row) => (row.id === id ? { ...row, enabled } : row)));
      return change(() => enableDictionary(id, enabled));
    },
    remove: (id: string) => change(() => deleteDictionary(id)),
  };
}
export type DictionaryController = ReturnType<typeof useDictionaries>;
