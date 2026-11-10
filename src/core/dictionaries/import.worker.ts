import { parseYomitan } from './parser';
import { listDictionaries, saveDictionary } from './storage';

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    if (file.size > 50 * 1024 * 1024) throw new Error('请选择不超过 50 MB 的 Yomitan ZIP 词典。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if ((await listDictionaries()).some((d) => d.id === id)) throw new Error('这份词典已经导入。');
    const parsed = parseYomitan(bytes, id, (message) =>
      self.postMessage({ type: 'progress', message }),
    );
    self.postMessage({ type: 'saving', message: '正在保存到本地，请稍候…' });
    await saveDictionary(parsed);
    self.postMessage({ type: 'done', info: parsed.info });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '词典导入失败。',
    });
  }
};
