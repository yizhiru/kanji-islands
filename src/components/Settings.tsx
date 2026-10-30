import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MAX_WORDS } from '../core/network';

interface Props {
  autoCollapse: boolean;
  visibleKanjiCount: number;
  onAutoCollapse: (enabled: boolean) => void;
  onVisibleKanjiCount: (count: number) => void;
  onClose: () => void;
}

export function Settings({
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
      <p className="settings-note">更改立即生效。</p>
    </dialog>
  );
}
