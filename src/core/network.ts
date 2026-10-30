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

export function removeExpansion(network: Network, kanji: string, vocab: Vocabulary): Network {
  const removed = network.expansions.find((e) => e.kanji === kanji);
  if (!removed) return network;
  const remaining = network.expansions.filter((e) => e.kanji !== kanji);
  const wordsByKanji = new Map(remaining.map((e) => [e.kanji, [] as string[]]));
  for (const id of network.words)
    for (const character of vocab.get(id).kanji) wordsByKanji.get(character)?.push(id);

  // Keep only the component connected to the seed through the remaining hubs.
  // Shared words survive; branches and cycles detached from the seed disappear.
  const reachableWords = new Set([network.root]);
  const reachableKanji = new Set<string>();
  const queue = [network.root];
  for (let index = 0; index < queue.length; index++) {
    for (const character of vocab.get(queue[index]).kanji) {
      if (!wordsByKanji.has(character) || reachableKanji.has(character)) continue;
      reachableKanji.add(character);
      for (const id of wordsByKanji.get(character)!) {
        if (reachableWords.has(id)) continue;
        reachableWords.add(id);
        queue.push(id);
      }
    }
  }
  const words = network.words.filter((id) => reachableWords.has(id));
  return {
    ...network,
    words,
    selected: reachableWords.has(network.selected)
      ? network.selected
      : reachableWords.has(removed.parent)
        ? removed.parent
        : network.root,
    expansions: remaining
      .filter((e) => reachableKanji.has(e.kanji))
      .map((e) => ({
        ...e,
        parent: reachableWords.has(e.parent)
          ? e.parent
          : wordsByKanji.get(e.kanji)!.find((id) => reachableWords.has(id))!,
      })),
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

// Only the most recently expanded characters retain all their displayed words.
// Older groups keep the routes to those characters and the selected word.
// Expansion order already promotes a shared hub when another batch is added.
export function collapsedNetwork(network: Network, vocab: Vocabulary, keepCount = 2): Network {
  const count = Number.isFinite(keepCount)
    ? Math.max(1, Math.min(MAX_WORDS, Math.floor(keepCount)))
    : 2;
  if (network.expansions.length <= count) return network;
  const graph = graphOf(network, vocab);
  const neighbors = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    neighbors.get(edge.source)!.push(edge.target);
    neighbors.get(edge.target)!.push(edge.source);
  }
  const parents = new Map<string, string | null>([[network.root, null]]);
  const queue = [network.root];
  for (let i = 0; i < queue.length; i++) {
    for (const id of neighbors.get(queue[i]) ?? []) {
      if (parents.has(id)) continue;
      parents.set(id, queue[i]);
      queue.push(id);
    }
  }
  const pathTo = (target: string) => {
    const path: string[] = [];
    let id: string | null = target;
    while (id != null && parents.has(id)) {
      path.push(id);
      id = parents.get(id)!;
    }
    return path.reverse();
  };
  const visible = new Set([...pathTo(network.selected), network.selected, network.root]);
  for (const expansion of network.expansions.slice(-count)) {
    const hub = `kanji:${expansion.kanji}`;
    for (const id of pathTo(hub)) visible.add(id);
    for (const word of neighbors.get(hub) ?? []) visible.add(word);
  }
  return {
    ...network,
    words: network.words.filter((id) => visible.has(id)),
    expansions: network.expansions.filter((e) => visible.has(`kanji:${e.kanji}`)),
  };
}
