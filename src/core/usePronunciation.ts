import { useCallback, useEffect, useRef, useState } from 'react';

import type { LocalSpeechEngine, LocalSpeechStatus, SpeechEngine } from './types';

const preferenceKey = 'kanji-islands.speech-engine';
const names = {
  system: '系统日语语音',
  voicevox: 'VOICEVOX',
  kokoro: 'Kokoro',
  openjtalk: 'Open JTalk',
} as const;
const fallbackWaitMs = 2500;

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
  const [engine, setPreference] = useState<SpeechEngine>(() => {
    try {
      const stored = localStorage.getItem(preferenceKey);
      if (stored === 'system' || stored === 'voicevox') return stored;
      if ((stored === 'kokoro' || stored === 'openjtalk') && window.islands?.synthesizeLocal)
        return stored;
      return localStorage.getItem('kanji-islands.prefer-voicevox') === 'true'
        ? 'voicevox'
        : 'system';
    } catch {
      return 'system';
    }
  });
  const local = engine === 'kokoro' || engine === 'openjtalk' ? engine : null;
  const [resources, setResources] = useState<Record<LocalSpeechEngine, LocalSpeechStatus>>({
    kokoro: { state: 'missing' },
    openjtalk: { state: 'missing' },
  });
  useEffect(() => {
    const bridge = window.islands;
    if (!bridge?.localSpeechStatus) return;
    let mounted = true;
    const changed = new Set<LocalSpeechEngine>();
    const unsubscribe = bridge.onLocalSpeechStatus((name, value) => {
      changed.add(name);
      setResources((previous) => ({ ...previous, [name]: value }));
    });
    void bridge
      .localSpeechStatus()
      .then((snapshot) => {
        if (mounted)
          setResources((previous) => ({
            kokoro: changed.has('kokoro') ? previous.kokoro : snapshot.kokoro,
            openjtalk: changed.has('openjtalk') ? previous.openjtalk : snapshot.openjtalk,
          }));
      })
      .catch(() => {});
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
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

  const stop = useCallback(() => {
    speechID.current++;
    stopAudio();
    setSpeaking('');
  }, [stopAudio]);

  const setEngine = (value: SpeechEngine) => {
    stop();
    setPreference(value);
    try {
      localStorage.setItem(preferenceKey, value);
    } catch {
      /* Session only. */
    }
  };
  const localStatus = local ? resources[local] : null;
  const downloadMessage =
    localStatus?.state === 'downloading'
      ? localStatus.done === localStatus.total
        ? '正在校验并展开词典…'
        : `正在下载 ${names[local!]} · ${Math.floor((localStatus.done / localStatus.total) * 100)}%`
      : localStatus?.state === 'preparing'
        ? '正在准备语音资源…'
        : '';

  const play = useCallback(
    (reading = readings[0], automatic = false) => {
      if (!reading) {
        if (!automatic) onNotify('这个词暂无可朗读的读音。');
        return;
      }
      const bridge = window.islands;
      const useVoicevox = voicevox === 'ready' && bridge?.synthesizeVoicevox;
      if (!local && !useVoicevox && !voice) {
        if (!automatic || !missingVoiceReported.current)
          onNotify(
            bridge?.voicevoxStatus
              ? '请在设置中选择日语朗读引擎。'
              : '本机未检测到日语语音，请安装后朗读。',
          );
        missingVoiceReported.current = true;
        return;
      }
      missingVoiceReported.current = false;
      // Each attempt owns its callbacks and audio; a new click or fallback retires the old one.
      const engines: SpeechEngine[] = [];
      if (local) engines.push(local);
      else {
        if (voice) engines.push('system');
        if (useVoicevox)
          engine === 'voicevox' ? engines.unshift('voicevox') : engines.push('voicevox');
      }
      let index = 0;
      function attempt() {
        const id = ++speechID.current;
        stopAudio();
        const current = () => speechID.current === id;
        const engine = engines[index++];
        const finish = () => {
          if (current()) stop();
        };
        const fail = () => {
          if (!current()) return;
          if (engine === 'voicevox') {
            statusRequest.current++;
            setVoicevox('unavailable');
          }
          if (index < engines.length) attempt();
          else {
            finish();
            onNotify(
              local
                ? `${names[local]} 朗读失败，可在设置中查看状态并重试。`
                : '朗读失败，请在设置中检查 VOICEVOX 连接或系统日语语音。',
            );
          }
        };
        setSpeaking(reading);
        if (engine === 'system') {
          try {
            const utterance = new SpeechSynthesisUtterance(reading);
            utterance.voice = voice;
            utterance.lang = 'ja-JP';
            utterance.rate = 0.85;
            utterance.onend = finish;
            utterance.onerror = (event) => {
              if (['interrupted', 'canceled'].includes(event.error)) finish();
              else fail();
            };
            window.speechSynthesis.speak(utterance);
          } catch {
            fail();
          }
          return;
        }
        // Allow slow cold starts when VOICEVOX is the only available engine.
        const timer = index < engines.length ? window.setTimeout(fail, fallbackWaitMs) : undefined;
        releaseAudio.current = () => window.clearTimeout(timer);
        void (async () => {
          try {
            const wav =
              engine === 'voicevox'
                ? await bridge!.synthesizeVoicevox(reading)
                : await bridge!.synthesizeLocal(engine, reading);
            if (!current()) return;
            const player = new Audio();
            const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
            releaseAudio.current = () => {
              window.clearTimeout(timer);
              player.onended = null;
              player.onerror = null;
              player.pause();
              player.removeAttribute('src');
              URL.revokeObjectURL(url);
            };
            player.onended = finish;
            player.onerror = fail;
            player.src = url;
            await player.play();
            window.clearTimeout(timer);
          } catch {
            fail();
          }
        })();
      }
      attempt();
    },
    [voice, voicevox, engine, local, readingKey, onNotify, stopAudio, stop],
  );

  useEffect(() => {
    if (request === lastRequest.current) return;
    lastRequest.current = request;
    if (autoPlay) play(undefined, true);
  }, [request, autoPlay, play]);

  return {
    voicevox,
    checkVoicevox,
    engine,
    setEngine,
    localStatus,
    downloadMessage,
    engineName: local
      ? names[local]
      : voicevox === 'ready' && (engine === 'voicevox' || !voice)
        ? names.voicevox
        : names.system,
    systemVoiceName: voice?.name,
    canPlay: !!local || voicevox === 'ready' || !!voice,
    speaking,
    stop,
    play,
  };
}

export type PronunciationController = ReturnType<typeof usePronunciation>;
