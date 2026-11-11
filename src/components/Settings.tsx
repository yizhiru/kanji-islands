import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DictionaryController } from '../core/dictionaries/useDictionaries';
import type { PronunciationController } from '../core/usePronunciation';
import { MAX_WORDS } from '../core/network';

interface Props {
  dictionaries: DictionaryController;
  speech: PronunciationController;
  autoCollapse: boolean;
  visibleKanjiCount: number;
  onAutoCollapse: (enabled: boolean) => void;
  onVisibleKanjiCount: (count: number) => void;
  onClose: () => void;
}

export function Settings({
  dictionaries,
  speech,
  autoCollapse,
  visibleKanjiCount,
  onAutoCollapse,
  onVisibleKanjiCount,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const helpId = useId();
  const [countInput, setCountInput] = useState(String(visibleKanjiCount));
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>设置</h2>
        <button className="icon-button" aria-label="关闭设置" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <section className="settings-section" aria-label="词网显示">
        <h3>词网显示</h3>
        <label className="settings-toggle">
          <span>自动折叠</span>
          <input
            type="checkbox"
            role="switch"
            aria-describedby={helpId}
            checked={autoCollapse}
            onChange={(event) => onAutoCollapse(event.target.checked)}
          />
        </label>
        <p id={helpId}>完整显示最近展开的汉字所关联的词汇，自动收起更早的词群。</p>
        <label className="settings-count">
          保留最近
          <input
            type="number"
            aria-label="自动折叠保留汉字数"
            title={`保留数量可设为 1–${MAX_WORDS}`}
            min={1}
            max={MAX_WORDS}
            step={1}
            value={countInput}
            disabled={!autoCollapse}
            onChange={(event) => {
              setCountInput(event.target.value);
              const count = event.target.valueAsNumber;
              if (Number.isInteger(count) && count >= 1 && count <= MAX_WORDS)
                onVisibleKanjiCount(count);
            }}
            onBlur={() => setCountInput(String(visibleKanjiCount))}
          />
          个汉字
        </label>
        <p>默认保留 2 个。当前词、共用词和必要连接始终保留；关闭自动折叠可显示全部词网。</p>
      </section>
      <section className="settings-section" aria-label="日语朗读">
        <h3>日语朗读</h3>
        {speech.voicevox === 'desktop-only' ? (
          <p>网页版使用系统日语语音。桌面版可连接本机 VOICEVOX。</p>
        ) : (
          <>
            <p>下载适合系统的版本，启动 VOICEVOX 后点「检测连接」。普通电脑可先选 CPU 版。</p>
            <div className="voicevox-actions">
              <a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noreferrer">
                下载 VOICEVOX
              </a>
              <a href="https://voicevox.hiroshiba.jp/how_to_use/" target="_blank" rel="noreferrer">
                安装指南
              </a>
              <button
                className="text-button"
                disabled={speech.voicevox === 'checking'}
                onClick={() => void speech.checkVoicevox()}
              >
                检测连接
              </button>
            </div>
            <p role="status">
              {speech.voicevox === 'ready'
                ? '已连接 · VOICEVOX:四国めたん'
                : speech.voicevox === 'checking'
                  ? '正在检测 VOICEVOX…'
                  : '未连接。已安装的系统日语语音仍可用于朗读。'}
            </p>
          </>
        )}
      </section>
      <section className="settings-section" aria-label="用户词典">
        <h3>用户词典</h3>
        <p>
          选择本地 Yomitan v3 ZIP
          词典。文件仅保存在此设备，不会上传；本软件不内置或自动下载明镜词典。
        </p>
        <label className="dictionary-import">
          导入 Yomitan 词典
          <input
            type="file"
            accept=".zip,application/zip"
            aria-label="导入 Yomitan 词典"
            disabled={!dictionaries.ready || !!dictionaries.progress || dictionaries.changing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) dictionaries.importFile(file);
              event.target.value = '';
            }}
          />
        </label>
        <details className="dictionary-help">
          <summary>如何获取词典</summary>
          <p>下载 Yomitan 格式的 ZIP，回到此处导入，无需解压或购买 API。</p>
          <ul>
            <li>
              <a
                href="https://yomidevs.github.io/wiktionary-to-yomitan/download/"
                target="_blank"
                rel="noreferrer"
              >
                维基词典下载
              </a>
              ：Source 选 Japanese，Target 选 Chinese 或 Japanese，Format 选 Yomitan。 文本采用 CC
              BY-SA 等开放许可，具体以词条和词典包声明为准（
              <a
                href="https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use"
                target="_blank"
                rel="noreferrer"
              >
                使用条款
              </a>
              ）。
            </li>
            <li>
              <a href="https://jitendex.org/pages/downloads.html" target="_blank" rel="noreferrer">
                Jitendex 下载
              </a>
              ：选择 Jitendex for Yomitan；日英词典，采用
              <a href="https://jitendex.org/pages/legal.html" target="_blank" rel="noreferrer">
                CC BY-SA 4.0
              </a>
              。本软件已保留内置英文释义，无需重复导入。
            </li>
          </ul>
          <p>明镜词典需用户自行取得有权使用的 Yomitan 词典包，此处不提供下载链接。</p>
        </details>
        {dictionaries.progress && (
          <div className="dictionary-progress" role="status">
            <span>{dictionaries.progress}</span>
            <button
              className="text-button"
              disabled={dictionaries.saving}
              onClick={dictionaries.cancel}
            >
              取消导入
            </button>
          </div>
        )}
        <p>
          标准与标日词库均优先使用启用词典的中文、日文释义；中文缺失时保留内置译文，英文释义继续保留。多部词典按最近导入优先。
        </p>
        <p className="muted">请导入你有权使用的词典；用户导入不改变词典本身的许可。</p>
        {!dictionaries.dictionaries.length && <p className="muted">尚未导入用户词典。</p>}
        {dictionaries.changing && <p role="status">正在保存词典更改…</p>}
        {dictionaries.dictionaries.map((dictionary) => (
          <div className="user-dictionary" key={dictionary.id}>
            <strong>{dictionary.title}</strong>
            <small>
              {dictionary.revision} · {dictionary.entryCount.toLocaleString()} 个词条 ·{' '}
              {dictionary.termCount.toLocaleString()} 条索引
            </small>
            <div className="dictionary-actions">
              <label>
                <input
                  type="checkbox"
                  checked={dictionary.enabled}
                  aria-label={`启用词典${dictionary.title}`}
                  disabled={!!dictionaries.progress || dictionaries.changing}
                  onChange={(event) =>
                    void dictionaries.toggle(dictionary.id, event.target.checked)
                  }
                />
                启用
              </label>
              <button
                className="text-button"
                aria-label={`删除词典${dictionary.title}`}
                disabled={!!dictionaries.progress || dictionaries.changing}
                onClick={() => void dictionaries.remove(dictionary.id)}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </section>
      <p className="settings-note">更改立即生效。</p>
    </dialog>
  );
}
