import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';
import type { SimulationNodeDatum } from 'd3-force';
import { LocateFixed, Minus, Plus, Move } from 'lucide-react';
import { graphOf } from '../core/network';
import type { Filter, Network } from '../core/types';
import { entriesFor, referencesFor, Vocabulary } from '../core/vocabulary';

interface Props {
  vocab: Vocabulary;
  network: Network;
  filter: Filter;
  showReading: boolean;
  onSelect: (id: string) => void;
  onExpand: (kanji: string) => void;
  onHub: (kanji: string) => void;
}
interface Positioned extends SimulationNodeDatum {
  id: string;
  kind: 'word' | 'kanji';
  text: string;
  root?: boolean;
  width: number;
}
const measure = (text: string) => Math.max(112, Math.min(270, [...text].length * 25 + 44));

export function NetworkCanvas({
  vocab,
  network,
  filter,
  showReading,
  onSelect,
  onExpand,
  onHub,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, Positioned>());
  const [nodes, setNodes] = useState<Positioned[]>([]);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; initialX: number; initialY: number } | null>(null);
  const graph = useMemo(() => graphOf(network, vocab), [network.words, network.expansions, vocab]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    positions.current.clear();
    setCamera({ x: 0, y: 0, zoom: 1 });
  }, [network.root, filter.scope, filter.lesson]);

  useEffect(() => {
    const list: Positioned[] = graph.nodes.map((node, i) => {
      const previous = positions.current.get(node.id);
      const angle = i * 2.39996;
      return {
        ...node,
        width: node.kind === 'kanji' ? 48 : measure(node.text),
        x: previous?.x ?? (node.root ? 0 : Math.cos(angle) * 180),
        y: previous?.y ?? (node.root ? 0 : Math.sin(angle) * 150),
      };
    });
    const links = graph.edges.map((edge) => ({ source: edge.source, target: edge.target }));
    const simulation = forceSimulation(list)
      .force(
        'link',
        forceLink<Positioned, { source: string; target: string }>(links)
          .id((n) => n.id)
          .distance(155)
          .strength(0.45),
      )
      .force('charge', forceManyBody().strength(-450))
      .force(
        'collide',
        forceCollide<Positioned>()
          .radius((n) => (n.kind === 'kanji' ? 43 : n.width / 2 + 14))
          .iterations(3),
      )
      .force('x', forceX(0).strength(0.035))
      .force('y', forceY(0).strength(0.045))
      .force('center', forceCenter(0, 0))
      .stop();
    // Settle before painting so nodes remain easy to click during expansion.
    simulation.tick(180);
    const settled = list.map((n) => ({ ...n }));
    positions.current = new Map(settled.map((n) => [n.id, n]));
    setNodes(settled);
    simulation.stop();
  }, [graph]);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fit = () => {
    if (!nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.x! - n.width / 2));
    const maxX = Math.max(...nodes.map((n) => n.x! + n.width / 2));
    const minY = Math.min(...nodes.map((n) => n.y! - 60));
    const maxY = Math.max(...nodes.map((n) => n.y! + 60));
    const zoom = Math.min(
      1,
      Math.max(
        0.18,
        Math.min(
          (size.width - 100) / Math.max(200, maxX - minX),
          (size.height - 110) / Math.max(200, maxY - minY),
        ),
      ),
    );
    setCamera({ zoom, x: (-(minX + maxX) / 2) * zoom, y: (-(minY + maxY) / 2) * zoom });
  };
  const zoomBy = (factor: number) =>
    setCamera((c) => ({ ...c, zoom: Math.max(0.18, Math.min(1.8, c.zoom * factor)) }));
  useEffect(() => {
    const element = host.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      setCamera((c) => {
        const zoom = Math.max(0.18, Math.min(1.8, c.zoom * Math.exp(-event.deltaY * 0.0015)));
        const ratio = zoom / c.zoom;
        return { zoom, x: x - (x - c.x) * ratio, y: y - (y - c.y) * ratio };
      });
    };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    if (nodes.length > 1) fit();
  }, [nodes, size.width, size.height]); // Each expansion stays in view.

  return (
    <div
      ref={host}
      className="network-canvas"
      data-testid="network-canvas"
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button')) return;
        drag.current = { x: e.clientX, y: e.clientY, initialX: camera.x, initialY: camera.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current)
          setCamera((c) => ({
            ...c,
            x: drag.current!.initialX + e.clientX - drag.current!.x,
            y: drag.current!.initialY + e.clientY - drag.current!.y,
          }));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <svg className="network-svg" width="100%" height="100%" aria-label="词汇关联网络">
        <g
          transform={`translate(${size.width / 2 + camera.x},${size.height / 2 + camera.y + (nodes.length === 1 ? 20 : 0)}) scale(${camera.zoom})`}
        >
          {graph.edges.map((edge) => {
            const a = byId.get(edge.source),
              b = byId.get(edge.target);
            return a && b ? (
              <line
                key={edge.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={`network-edge ${edge.target === network.selected ? 'is-selected' : ''}`}
              />
            ) : null;
          })}
          {nodes.map((node) => {
            if (node.kind === 'kanji')
              return (
                <foreignObject
                  key={node.id}
                  x={node.x! - 26}
                  y={node.y! - 26}
                  width={52}
                  height={52}
                >
                  <button
                    className="hub-node"
                    onClick={() => onHub(node.text)}
                    aria-label={`继续展开共用汉字${node.text}`}
                    title={`继续添加含「${node.text}」的词`}
                  >
                    {node.text}
                  </button>
                </foreignObject>
              );
            const word = vocab.get(node.id);
            const selected = node.id === network.selected;
            const entries = entriesFor(word, filter);
            const reading = [...new Set(entries.map((e) => e.reading_hiragana))].join(' / ');
            return (
              <foreignObject
                key={node.id}
                x={node.x! - node.width / 2}
                y={node.y! - 46}
                width={node.width}
                height={110}
                className="word-object"
              >
                <div
                  className={`word-node ${selected ? 'is-selected' : ''} ${node.root ? 'is-root' : ''} ${showReading ? 'show-reading' : ''}`}
                  title={reading || '词库中暂无读音'}
                  style={{ fontSize: [...node.text].length > 8 ? 17 : 25 }}
                  data-testid="word-node"
                  data-word={node.text}
                >
                  {selected ? (
                    <div className="node-glyphs" aria-label={`当前词汇${node.text}`}>
                      {[...node.text].map((c, i) =>
                        word.kanji.includes(c) ? (
                          <button
                            key={i}
                            className="glyph-button"
                            onClick={() => onExpand(c)}
                            aria-label={`展开汉字${c}`}
                            title={`展开含「${c}」的词`}
                          >
                            {c}
                          </button>
                        ) : (
                          <span key={i}>{c}</span>
                        ),
                      )}
                    </div>
                  ) : (
                    <button
                      className="word-select"
                      onClick={() => onSelect(node.id)}
                      aria-label={`选中词汇${node.text}`}
                    >
                      {node.text}
                    </button>
                  )}
                  <span className="node-subtitle node-reference">
                    {node.root ? '探索起点' : referencesFor(entries, filter) || '自定义词汇'}
                  </span>
                  <span className="node-subtitle node-reading" lang="ja">
                    {reading || '词库中暂无读音'}
                  </span>
                </div>
              </foreignObject>
            );
          })}
        </g>
      </svg>
      {nodes.length === 1 && <div className="first-step">点击汉字，连接词汇</div>}
      <div className="canvas-footer">
        <span>
          <Move size={14} /> 拖动平移 · 滚轮缩放
        </span>
        <div className="zoom-controls">
          <button aria-label="缩小网络" title="缩小" onClick={() => zoomBy(1 / 1.2)}>
            <Minus size={16} />
          </button>
          <span>{Math.round(camera.zoom * 100)}%</span>
          <button aria-label="放大网络" title="放大" onClick={() => zoomBy(1.2)}>
            <Plus size={16} />
          </button>
          <i />
          <button aria-label="适应全部节点" title="适应全部节点" onClick={fit}>
            <LocateFixed size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
