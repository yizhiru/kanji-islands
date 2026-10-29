export const dictionaryURL = (word: string, reading = '') =>
  `https://jisho.org/search/${encodeURIComponent(reading && reading !== word ? `${word} ${reading}` : word)}`;

export async function copyText(text: string): Promise<void> {
  if (window.islands) return window.islands.copyText(text);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Older webviews and denied clipboard permissions still support selected text copying.
    }
  }
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const focused = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.append(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    input.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }
}
