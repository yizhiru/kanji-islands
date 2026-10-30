import { useCallback, useEffect, useRef, useState } from 'react';

export function usePronunciation(
  word: string,
  readings: string[],
  autoPlay: boolean,
  request: number,
  onNotify: (message: string) => void,
) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState('');
  const speechID = useRef(0);
  const lastRequest = useRef(request);
  const missingVoiceReported = useRef(false);
  const readingKey = readings.join('|');
  const voice = voices[0];

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
  }, [word, readingKey]);

  const play = useCallback(
    (reading = readings[0], automatic = false) => {
      if (!reading) {
        if (!automatic) onNotify('这个词暂无可朗读的读音。');
        return;
      }
      if (!voice) {
        if (!automatic || !missingVoiceReported.current)
          onNotify('本机未检测到日语语音，请安装后朗读。');
        missingVoiceReported.current = true;
        return;
      }
      missingVoiceReported.current = false;
      const id = ++speechID.current;
      try {
        window.speechSynthesis.cancel();
        setSpeaking('');
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
    },
    [voice, readingKey, onNotify],
  );

  useEffect(() => {
    if (request === lastRequest.current) return;
    lastRequest.current = request;
    if (autoPlay) play(undefined, true);
  }, [request, autoPlay, play]);

  return { voice, speaking, play };
}

export type PronunciationController = ReturnType<typeof usePronunciation>;
