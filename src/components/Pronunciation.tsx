import { ExternalLink, Info, Volume2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { dictionaryURL } from '../core/actions';

export function Pronunciation({
  word,
  readings,
  onNotify,
}: {
  word: string;
  readings: string[];
  onNotify: (message: string) => void;
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState('');
  const speechID = useRef(0);
  const helpID = useId();
  const help = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (!helpOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!help.current?.contains(event.target as Node)) {
        pinned.current = false;
        setHelpOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [helpOpen]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () =>
      setVoices(
        window.speechSynthesis
          .getVoices()
          .filter((v) => /^ja(?:[-_]|$)/i.test(v.lang) && v.localService),
      );
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  useEffect(() => {
    setSpeaking('');
    return () => {
      speechID.current++;
      window.speechSynthesis?.cancel();
    };
  }, [word, readings.join('|')]);
  const voice = voices[0];
  return (
    <div className="pronunciation">
      <div className="pronunciation-actions">
        {readings.map((reading) => (
          <button
            key={reading}
            className="text-button"
            disabled={!voice}
            aria-label={`朗读${reading}`}
            title={
              voice
                ? '使用本机日语语音朗读假名'
                : '请先在系统设置中安装日语语音，或打开词典查看读音'
            }
            onClick={() => {
              const id = ++speechID.current;
              try {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(reading);
                utterance.voice = voice;
                utterance.lang = 'ja-JP';
                utterance.rate = 0.85;
                utterance.onstart = () => {
                  if (speechID.current === id) setSpeaking(reading);
                };
                utterance.onend = () => {
                  if (speechID.current === id) setSpeaking('');
                };
                utterance.onerror = (event) => {
                  if (speechID.current !== id) return;
                  setSpeaking('');
                  if (!['interrupted', 'canceled'].includes(event.error))
                    onNotify('系统朗读失败，可以打开词典查看读音。');
                };
                window.speechSynthesis.speak(utterance);
              } catch {
                setSpeaking('');
                onNotify('系统朗读失败，可以打开词典查看读音。');
              }
            }}
          >
            <Volume2 size={14} /> {speaking === reading ? '正在朗读' : '朗读'}
            {readings.length > 1 && <span lang="ja">{reading}</span>}
          </button>
        ))}
        <a
          className="text-button dictionary-link"
          href={dictionaryURL(word)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={async (event) => {
            if (!window.islands) return;
            event.preventDefault();
            try {
              await window.islands.openDictionary(word, '');
            } catch {
              onNotify('词典打开失败，请稍后重试。');
            }
          }}
        >
          Jisho 词典 <ExternalLink size={13} />
        </a>
        <div
          ref={help}
          className="pronunciation-help"
          onPointerEnter={() => setHelpOpen(true)}
          onPointerLeave={() => {
            if (!pinned.current && !help.current?.contains(document.activeElement))
              setHelpOpen(false);
          }}
          onFocus={() => setHelpOpen(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              pinned.current = false;
              setHelpOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              pinned.current = false;
              setHelpOpen(false);
            }
          }}
        >
          <button
            className="pronunciation-help-button"
            aria-label="读音说明"
            aria-expanded={helpOpen}
            aria-controls={helpID}
            aria-describedby={helpOpen ? helpID : undefined}
            onClick={() => {
              pinned.current = !pinned.current;
              setHelpOpen(pinned.current);
            }}
          >
            <Info size={15} />
          </button>
          <p id={helpID} className="pronunciation-note" role="tooltip" hidden={!helpOpen}>
            {voice
              ? '系统合成语音，仅供读音参考。'
              : readings.length
                ? '本机未检测到日语语音，可安装后朗读。'
                : ''}
            词典需联网，真人音频以收录为准。
          </p>
        </div>
      </div>
    </div>
  );
}
