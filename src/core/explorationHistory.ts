import { MAX_WORDS, startNetwork } from './network';
import type { Filter, Network } from './types';
import { wordId } from './vocabulary';

interface Timeline {
  present: Network;
  past: Network[];
  future: Network[];
}

export interface ExplorationHistory {
  filter: Filter;
  timeline: Timeline;
}

const storageKey = 'kanji-islands.exploration.v1';
export const HISTORY_LIMIT = 60;

function isNetwork(value: unknown): value is Network {
  const network = value as Partial<Network> | null;
  if (!network || !Array.isArray(network.words) || !Array.isArray(network.expansions)) return false;
  const words = new Set(network.words);
  return (
    words.size === network.words.length &&
    words.size <= MAX_WORDS &&
    network.words.every(
      (id) => typeof id === 'string' && id.startsWith('word:') && id.length > 5,
    ) &&
    typeof network.root === 'string' &&
    words.has(network.root) &&
    typeof network.selected === 'string' &&
    words.has(network.selected) &&
    network.expansions.length <= MAX_WORDS &&
    network.expansions.every(
      (branch) =>
        branch &&
        typeof branch.kanji === 'string' &&
        /^\p{Unified_Ideograph}$/u.test(branch.kanji) &&
        words.has(branch.parent) &&
        Number.isSafeInteger(branch.limit) &&
        branch.limit >= 0,
    )
  );
}

export function loadExploration(): ExplorationHistory {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) ?? 'null',
    ) as ExplorationHistory | null;
    if (
      saved?.filter &&
      ['all', 'textbook', 'beginner', 'intermediate'].includes(saved.filter.scope) &&
      typeof saved.filter.lesson === 'string' &&
      saved.timeline &&
      isNetwork(saved.timeline.present)
    ) {
      const steps = (value: unknown) =>
        Array.isArray(value) ? value.slice(0, HISTORY_LIMIT).filter(isNetwork) : [];
      return {
        filter: saved.filter,
        timeline: {
          present: saved.timeline.present,
          past: steps(saved.timeline.past),
          future: steps(saved.timeline.future),
        },
      };
    }
  } catch {
    // Unavailable or damaged storage is equivalent to a fresh start.
  }
  return {
    filter: { scope: 'all', lesson: '' },
    timeline: { present: startNetwork(wordId('発表')), past: [], future: [] },
  };
}

export function saveExploration(history: ExplorationHistory) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(history));
  } catch {
    // The current session remains usable if local storage is unavailable.
  }
}
