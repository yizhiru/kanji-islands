import { Copy } from 'lucide-react';
import { copyText } from '../core/actions';

export function CopyButton({
  text,
  label,
  compact = false,
  onNotify,
}: {
  text: string;
  label: string;
  compact?: boolean;
  onNotify: (message: string) => void;
}) {
  return (
    <button
      className={compact ? 'card-copy' : 'text-button copy-button'}
      aria-label={label}
      title="复制单词"
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await copyText(text);
          onNotify(`已复制「${text}」`);
        } catch {
          onNotify('复制失败，请在详情区选中文字后按 ⌘C / Ctrl+C。');
        }
      }}
    >
      <Copy size={compact ? 12 : 14} />
      {!compact && '复制单词'}
    </button>
  );
}
