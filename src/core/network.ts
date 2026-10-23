import type { Filter, Network } from './types';
import { Vocabulary } from './vocabulary';

export const BATCH_SIZE = 8;
export const MAX_WORDS = 160;
export const startNetwork = (id: string): Network => ({
  root: id,
  selected: id,
  words: [id],
  expansions: [],
});

export function expandNetwork(
  network: Network,
  kanji: string,
  vocab: Vocabulary,
  filter: Filter,
): Network {
  const parent = vocab.get(network.selected);
  if (!parent.kanji.includes(kanji)) return network;
  const available = vocab.related(kanji, filter, parent.id);
  if (!available.length) return network;
  const existing = network.expansions.find((e) => e.kanji === kanji);
  // A single character hub is shared across branches, making real cycles possible.
  const limit = Math.min(available.length, (existing?.limit ?? 0) + BATCH_SIZE);
  const words = [...network.words];
  for (const word of available.slice(0, limit)) {
    if (words.length >= MAX_WORDS) break;
    if (!words.includes(word.id)) words.push(word.id);
  }
  const expansion = { kanji, parent: existing?.parent ?? parent.id, limit };
  return {
    ...network,
    words,
    expansions: [...network.expansions.filter((e) => e.kanji !== kanji), expansion],
  };
}

export interface GraphNode {
  id: string;
  kind: 'word' | 'kanji';
  text: string;
  root?: boolean;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kanji: string;
}
export function graphOf(
  network: Network,
  vocab: Vocabulary,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = network.words.map((id) => ({
    id,
    kind: 'word',
    text: vocab.get(id).text,
    root: id === network.root,
  }));
  const edges: GraphEdge[] = [];
  for (const { kanji } of network.expansions) {
    const hub = `kanji:${kanji}`;
    nodes.push({ id: hub, kind: 'kanji', text: kanji });
    for (const id of network.words)
      if (vocab.get(id).kanji.includes(kanji)) {
        edges.push({ id: `${hub}|${id}`, source: hub, target: id, kanji });
      }
  }
  return { nodes, edges };
}
