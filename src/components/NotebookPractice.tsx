import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BookmarkMinus,
  Check,
  Eye,
  EyeOff,
  LogOut,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import type { PronunciationController } from '../core/usePronunciation';
import { practiceAnswer, type PracticeCard } from '../core/practiceBooks';
import type { Vocabulary } from '../core/vocabulary';

function shuffled(cards: readonly PracticeCard[]) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

interface Props {
  cards: readonly PracticeCard[];
  title: string;
  returnLabel?: string;
  group?: number;
  onNextGroup?: () => void;
  vocab: Vocabulary;
  speech: PronunciationController;
  message: string;
  onSetRemoved: (card: PracticeCard, removed: boolean) => boolean | Promise<boolean>;
  onNotify: (message: string) => void;
  onClose: () => void;
}

export function NotebookPractice({
  cards,
  title,
  returnLabel = '返回词本选择',
  group,
  onNextGroup,
  vocab,
  speech,
  message,
  onSetRemoved,
  onNotify,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // A round keeps its original order and length as familiar words are removed.
  const [deck, setDeck] = useState(() => shuffled(cards));
  const [index, setIndex] = useState(0);
  const [showKana, setShowKana] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [removed, setRemoved] = useState<PracticeCard | null>(null);
  const [saving, setSaving] = useState(false);
  const card = deck[index];
  const answer = card && practiceAnswer(card, vocab);
  const { stop } = speech;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      stop();
      element.close();
    };
  }, [stop]);

  const moveTo = (position: number) => {
    stop();
    onNotify('');
    setShowKana(false);
    setShowMeaning(false);
    setIndex(position);
    setRemoved(null);
  };

  async function changeRemoval(target: PracticeCard, remove: boolean) {
    setSaving(true);
    try {
      if (await onSetRemoved(target, remove)) {
        moveTo(index + (remove ? 1 : -1));
        if (remove) setRemoved(target);
      }
    } catch {
      onNotify('词本保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      className="practice-dialog"
      ref={dialog}
      aria-labelledby="practice-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="practice-layout">
        <header className="practice-header">
          <h2 id="practice-title">{title}</h2>
          <span aria-live="polite">
            {group && `第 ${group} 组 · `}
            {Math.min(index + 1, deck.length)} / {deck.length}
          </span>
          <button className="secondary-button" onClick={onClose}>
            <LogOut size={16} />
            退出练习
          </button>
        </header>
        <progress
          className="practice-progress"
          aria-label="练习进度"
          max={deck.length || 1}
          value={Math.min(index + 1, deck.length)}
        />
        <div className="practice-main">
          {card ? (
            <>
              <section className="practice-card" aria-label="当前单词">
                <button
                  className="practice-word"
                  lang="ja"
                  aria-label={`朗读${card.word}`}
                  onClick={() => speech.play(answer.readings[0] ?? '')}
                >
                  {card.word}
                  <Volume2 size={23} aria-hidden="true" />
                </button>
                {showKana ? (
                  <p className="practice-kana" lang="ja">
                    {answer.readings.join(' / ') || '暂无假名'}
                  </p>
                ) : (
                  <p className="practice-hint">
                    {speech.speaking ? '正在朗读…' : '先自己读一遍，再点单词听发音'}
                  </p>
                )}
                {showMeaning && <p className="practice-meaning">{answer.meaning || '暂无释义'}</p>}
              </section>
              <div className="practice-reveal">
                <button
                  className="secondary-button"
                  aria-pressed={showKana}
                  onClick={() => setShowKana(!showKana)}
                >
                  {showKana ? <EyeOff size={15} /> : <Eye size={15} />}
                  {showKana ? '隐藏假名' : '显示假名'}
                </button>
                <button
                  className="text-button"
                  aria-pressed={showMeaning}
                  onClick={() => setShowMeaning(!showMeaning)}
                >
                  {showMeaning ? '隐藏释义' : '显示释义'}
                </button>
              </div>
            </>
          ) : (
            <section className="practice-card">
              <Check size={32} />
              <h3>本轮练习完成</h3>
              <p>
                {group
                  ? `本组还有 ${cards.length} 个词条可复习。`
                  : `生词本中还有 ${cards.length} 个词。`}
              </p>
              {cards.length > 0 && (
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => {
                    setDeck(shuffled(cards));
                    moveTo(0);
                  }}
                >
                  <RotateCcw size={15} />
                  再练一轮
                </button>
              )}
            </section>
          )}
          {removed && (
            <div className="practice-feedback">
              <span role="status">
                已将「{removed.word}」移出{group ? '本词本' : '生词本'}
              </span>
              <button
                className="text-button"
                disabled={saving}
                onClick={() => void changeRemoval(removed, false)}
              >
                撤回移除
              </button>
            </div>
          )}
          {message && (
            <p className="practice-feedback" role="status">
              {message}
            </p>
          )}
        </div>
        <footer className="practice-actions">
          {card ? (
            <>
              <button
                className="text-button"
                disabled={saving}
                onClick={() => void changeRemoval(card, true)}
              >
                <BookmarkMinus size={17} />
                {group ? '从本词本移除' : '移出生词本'}
              </button>
              <button
                className="primary-button"
                disabled={saving}
                onClick={() => moveTo(index + 1)}
              >
                {index + 1 < deck.length ? '下一个' : '完成练习'}
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <button className={onNextGroup ? 'text-button' : 'primary-button'} onClick={onClose}>
                {returnLabel}
              </button>
              {onNextGroup && (
                <button className="primary-button" disabled={saving} onClick={onNextGroup}>
                  练习下一组 <ArrowRight size={16} />
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}
