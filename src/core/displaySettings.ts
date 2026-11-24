import { MAX_WORDS } from './network';

export interface DisplaySettings {
  autoCollapse: boolean;
  visibleKanjiCount: number;
  showReading: boolean;
  showPartOfSpeech: boolean;
}

const key = 'kanji-islands.display-settings.v1';
const defaults: DisplaySettings = {
  autoCollapse: true,
  visibleKanjiCount: 2,
  showReading: true,
  showPartOfSpeech: false,
};

export function loadDisplaySettings(): DisplaySettings {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    return {
      autoCollapse:
        typeof saved?.autoCollapse === 'boolean' ? saved.autoCollapse : defaults.autoCollapse,
      visibleKanjiCount:
        Number.isInteger(saved?.visibleKanjiCount) &&
        saved.visibleKanjiCount >= 1 &&
        saved.visibleKanjiCount <= MAX_WORDS
          ? saved.visibleKanjiCount
          : defaults.visibleKanjiCount,
      showPartOfSpeech: saved?.showPartOfSpeech === true,
      showReading:
        typeof saved?.showReading === 'boolean' ? saved.showReading : defaults.showReading,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveDisplaySettings(settings: DisplaySettings) {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // Display controls remain usable for this session when storage is unavailable.
  }
}
