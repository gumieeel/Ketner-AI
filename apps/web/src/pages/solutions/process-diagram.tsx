import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { BotDiagram, BotDiagramNode } from '@/features/builder/api';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import {
  diagramSize,
  LABEL_LH,
  LABEL_LINE,
  NODE_H,
  NODE_W,
  NOTE_LH,
  NOTE_LINE,
  position,
  TEXT_X,
  wrapText,
} from './process-diagram-layout';

/**
 * Схема процесса только для чтения (docs/BUILDER_V1.md, раздел 5). Узлы, связи и раскладку
 * (колонка, строка) считает сервер; здесь только рисунок.
 *
 * Вид выбирается по ширине контейнера, а не экрана: если схема слева направо помещается в масштабе
 * 1 — SVG (`role="img"`, описание текстом под ним); иначе — те же узлы сверху вниз по связям.
 * Схема не уменьшается: мелкий текст хуже вертикального списка. В колонке кабинета (~650 px) это
 * список даже на широком экране. Перетаскивать и соединять нельзя.
 */

const STATE_STROKE: Record<NonNullable<BotDiagramNode['state']>, string> = {
  ok: 'stroke-success',
  attention: 'stroke-warning',
  paused: 'stroke-subtle',
  off: 'stroke-stroke-strong',
};

const STATE_DOT: Record<NonNullable<BotDiagramNode['state']>, string> = {
  ok: 'bg-success',
  attention: 'bg-warning',
  paused: 'bg-subtle',
  off: 'bg-stroke-strong',
};

const RISK_KEY = {
  low: 'builder.bot.diagram.risk.low',
  medium: 'builder.bot.diagram.risk.medium',
  high: 'builder.bot.diagram.risk.high',
  critical: 'builder.bot.diagram.risk.critical',
} as const;

/** Вторая строка узла: состояние подключения или уровень риска шага. */
function useNote() {
  const { t } = useTranslation();
  return (node: BotDiagramNode) =>
    node.stateLabel ?? (node.risk ? t(RISK_KEY[node.risk]) : undefined);
}

/** Ширина контейнера; `null` — ещё не измерена (тогда список: он помещается всегда). */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function ProcessDiagram({ diagram }: { diagram: BotDiagram }) {
  const { ref, width: available } = useContainerWidth();
  const size = diagramSize(diagram);
  const fits = available !== null && available >= size.width;
  return (
    <div
      ref={ref}
      className="mt-4"
      data-testid="process-diagram"
      data-view={fits ? 'diagram' : 'list'}
    >
      {fits ? <DiagramSvg diagram={diagram} size={size} /> : <DiagramList diagram={diagram} />}
    </div>
  );
}

function DiagramSvg({
  diagram,
  size,
}: {
  diagram: BotDiagram;
  size: { width: number; height: number };
}) {
  const { t } = useTranslation();
  const note = useNote();
  const descriptionId = useId();
  const markerId = `arrow-${useId().replace(/:/g, '')}`;
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  return (
    <>
      <svg
        role="img"
        aria-label={t('builder.bot.diagram.label')}
        aria-describedby={descriptionId}
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="block"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 8 8"
            refX="8"
            refY="4"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" className="fill-stroke-strong" />
          </marker>
        </defs>
        {diagram.edges.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const a = position(from);
          const b = position(to);
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x - 2;
          const y2 = b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`${edge.from}>${edge.to}`}
              d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
              className="fill-none stroke-stroke-strong"
              strokeWidth={1.5}
              markerEnd={`url(#${markerId})`}
            />
          );
        })}
        {diagram.nodes.map((node) => {
          const { x, y } = position(node);
          const second = note(node);
          const label = wrapText(node.label, LABEL_LINE);
          const notes = second ? wrapText(second, NOTE_LINE) : [];
          // Строки по центру узла: заголовок, затем подпись.
          const block = label.length * LABEL_LH + notes.length * NOTE_LH;
          const top = y + (NODE_H - block) / 2;
          return (
            <g key={node.id} data-node={node.id}>
              <title>{second ? `${node.label} — ${second}` : node.label}</title>
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={12}
                className={cn(
                  'fill-surface',
                  node.state ? STATE_STROKE[node.state] : 'stroke-stroke',
                )}
                strokeWidth={node.state === 'attention' ? 2 : 1.25}
                strokeDasharray={
                  node.state === 'paused' || node.state === 'off' ? '5 4' : undefined
                }
              />
              <text className="fill-text text-[13px] font-medium">
                {label.map((line, index) => (
                  <tspan key={index} x={x + TEXT_X} y={top + LABEL_LH * (index + 1) - 4}>
                    {line}
                  </tspan>
                ))}
              </text>
              {notes.length > 0 ? (
                <text className="fill-muted text-[12px]">
                  {notes.map((line, index) => (
                    <tspan
                      key={index}
                      x={x + TEXT_X}
                      y={top + label.length * LABEL_LH + NOTE_LH * (index + 1) - 2}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <details className="mt-3 text-[14px] leading-6 text-muted">
        <summary className="cursor-pointer text-text">{t('builder.bot.diagram.asText')}</summary>
        <ul id={descriptionId} className="mt-2 flex flex-col gap-1">
          {diagram.description.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

/** Те же узлы сверху вниз по связям; ветки — с отступом под своим узлом. */
function DiagramList({ diagram }: { diagram: BotDiagram }) {
  const { t } = useTranslation();
  const note = useNote();
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const childrenOf = (id: string) =>
    diagram.edges
      .filter((edge) => edge.from === id)
      .map((edge) => byId.get(edge.to))
      .filter((node): node is BotDiagramNode => Boolean(node));
  const roots = diagram.nodes.filter((node) => !diagram.edges.some((edge) => edge.to === node.id));
  const seen = new Set<string>();
  return (
    <ol className="flex flex-col gap-4" aria-label={t('builder.bot.diagram.label')}>
      {roots.map((root) => (
        <li key={root.id}>
          <Chain node={root} childrenOf={childrenOf} note={note} seen={seen} />
        </li>
      ))}
    </ol>
  );
}

/** Узел и всё, что после него: одно продолжение — стрелкой вниз, несколько — ветками с отступом. */
function Chain({
  node,
  childrenOf,
  note,
  seen,
}: {
  node: BotDiagramNode;
  childrenOf: (id: string) => BotDiagramNode[];
  note: (node: BotDiagramNode) => string | undefined;
  seen: Set<string>;
}) {
  seen.add(node.id);
  const next = childrenOf(node.id).filter((child) => !seen.has(child.id));
  const second = note(node);
  return (
    <div className="flex flex-col items-stretch gap-1" data-chain={node.id}>
      <div
        className={cn(
          'rounded-xl border bg-surface px-4 py-3',
          node.state === 'attention' ? 'border-warning' : 'border-stroke',
          node.state === 'paused' || node.state === 'off' ? 'border-dashed' : '',
        )}
      >
        <p className="flex items-center gap-2 text-[15px] font-medium break-words text-text">
          {node.state ? (
            <span
              aria-hidden="true"
              className={cn('size-2 shrink-0 rounded-full', STATE_DOT[node.state])}
            />
          ) : null}
          {node.label}
        </p>
        {second ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{second}</p> : null}
      </div>
      {next.length === 1 ? (
        <>
          <span aria-hidden="true" className="self-center text-subtle">
            ↓
          </span>
          <Chain node={next[0]!} childrenOf={childrenOf} note={note} seen={seen} />
        </>
      ) : null}
      {next.length > 1 ? (
        <ul className="mt-1 ml-3 flex flex-col gap-4">
          {next.map((child) => (
            <li key={child.id} className="border-l-2 border-stroke-strong pl-3">
              <Chain node={child} childrenOf={childrenOf} note={note} seen={seen} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
