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
  const [voicevox, setVoicevox] = useState<'checking' | 'ready' | 'unavailable' | 'desktop-only'>(
    window.islands?.voicevoxStatus ? 'checking' : 'desktop-only',
  );
  const statusRequest = useRef(0);
  const releaseAudio = useRef<(() => void) | null>(null);
  const speechID = useRef(0);
  const lastRequest = useRef(request);
  const missingVoiceReported = useRef(false);
  const readingKey = readings.join('|');
  const voice = voices[0];
  const checkVoicevox = useCallback(async () => {
    const bridge = window.islands;
    if (!bridge?.voicevoxStatus) return;
    const id = ++statusRequest.current;
    setVoicevox('checking');
    const ready = await bridge.voicevoxStatus().catch(() => false);
    if (id === statusRequest.current) setVoicevox(ready ? 'ready' : 'unavailable');
  }, []);

  useEffect(() => {
    void checkVoicevox();
    return () => {
      statusRequest.current++;
    };
  }, [checkVoicevox]);

  const stopAudio = useCallback(() => {
    releaseAudio.current?.();
    releaseAudio.current = null;
    window.speechSynthesis?.cancel();
  }, []);

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
      stopAudio();
    };
  }, [word, readingKey, stopAudio]);

  const play = useCallback(
    (reading = readings[0], automatic = false) => {
      if (!reading) {
        if (!automatic) onNotify('这个词暂无可朗读的读音。');
        return;
      }
      const bridge = window.islands;
      const useVoicevox = voicevox === 'ready' && bridge?.synthesizeVoicevox;
      if (!useVoicevox && !voice) {
        if (!automatic || !missingVoiceReported.current)
          onNotify(
            bridge?.voicevoxStatus
              ? '请在设置中连接 VOICEVOX，或安装系统日语语音。'
              : '本机未检测到日语语音，请安装后朗读。',
          );
        missingVoiceReported.current = true;
        return;
      }
      missingVoiceReported.current = false;
      const id = ++speechID.current;
      stopAudio();
      setSpeaking('');
      if (useVoicevox && bridge) {
        setSpeaking(reading);
        const finish = () => {
          if (speechID.current !== id) return;
          stopAudio();
          setSpeaking('');
        };
        void (async () => {
          try {
            const wav = await bridge.synthesizeVoicevox(reading);
            if (speechID.current !== id) return;
            const player = new Audio();
            const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
            releaseAudio.current = () => {
              player.onended = null;
              player.onerror = null;
              player.pause();
              player.removeAttribute('src');
              URL.revokeObjectURL(url);
            };
            player.onended = finish;
            player.onerror = () => {
              finish();
              onNotify('VOICEVOX 音频播放失败。');
            };
            player.src = url;
            await player.play();
          } catch {
            if (speechID.current !== id) return;
            finish();
            onNotify('VOICEVOX 朗读失败，请确认它仍在运行。');
            void checkVoicevox();
          }
        })();
        return;
      }
      try {
        const utterance = new SpeechSynthesisUtterance(reading);
        utterance.voice = voice ?? null;
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
    [voice, voicevox, readingKey, onNotify, stopAudio, checkVoicevox],
  );

  useEffect(() => {
    if (request === lastRequest.current) return;
    lastRequest.current = request;
    if (autoPlay) play(undefined, true);
  }, [request, autoPlay, play]);

  return {
    voicevox,
    checkVoicevox,
    canPlay: voicevox === 'ready' || !!voice,
    speaking,
    play,
  };
}

export type PronunciationController = ReturnType<typeof usePronunciation>;
