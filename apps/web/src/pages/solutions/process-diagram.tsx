import { useId } from 'react';
import type { BotDiagram, BotDiagramNode } from '@/features/builder/api';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/**
 * Схема процесса только для чтения (docs/BUILDER_V1.md, раздел 5). Узлы, связи и раскладку
 * (колонка, строка) считает сервер; здесь только рисунок: SVG на широком экране, вертикальный
 * список тех же узлов на телефоне. Схема — `role="img"` с описанием; то же описание текстом рядом.
 * Перетаскивать и соединять нельзя.
 */

const NODE_W = 200;
const NODE_H = 60;
const GAP_X = 44;
const GAP_Y = 16;
const PAD = 2;
/** Символов в строке узла: заголовок 13px и подпись 12px в 172px текста. */
const LABEL_MAX = 23;
const NOTE_MAX = 27;

const position = (node: BotDiagramNode) => ({
  x: PAD + node.level * (NODE_W + GAP_X),
  y: PAD + node.row * (NODE_H + GAP_Y),
});

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

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

export function ProcessDiagram({ diagram }: { diagram: BotDiagram }) {
  const { t } = useTranslation();
  const note = useNote();
  const descriptionId = useId();
  const markerId = `arrow-${useId().replace(/:/g, '')}`;
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const columns = Math.max(0, ...diagram.nodes.map((node) => node.level)) + 1;
  const rows = Math.max(0, ...diagram.nodes.map((node) => node.row)) + 1;
  const width = PAD * 2 + columns * NODE_W + (columns - 1) * GAP_X;
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y;
  const childrenOf = (id: string) =>
    diagram.edges
      .filter((edge) => edge.from === id)
      .map((edge) => byId.get(edge.to))
      .filter((node): node is BotDiagramNode => Boolean(node));
  const roots = diagram.nodes.filter((node) => !diagram.edges.some((edge) => edge.to === node.id));

  return (
    <div className="mt-4" data-testid="process-diagram">
      <div className="hidden overflow-x-auto md:block">
        <svg
          role="img"
          aria-label={t('builder.bot.diagram.label')}
          aria-describedby={descriptionId}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="max-w-none"
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
                <text
                  x={x + 14}
                  y={second ? y + 25 : y + NODE_H / 2 + 5}
                  className="fill-text text-[13px] font-medium"
                >
                  {clip(node.label, LABEL_MAX)}
                </text>
                {second ? (
                  <text x={x + 14} y={y + 44} className="fill-muted text-[12px]">
                    {clip(second, NOTE_MAX)}
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
      </div>

      {/* Телефон: те же узлы сверху вниз по связям; ветки — с отступом под своим узлом. */}
      <ol className="flex flex-col gap-4 md:hidden" aria-label={t('builder.bot.diagram.label')}>
        {roots.map((root) => (
          <li key={root.id}>
            <Chain node={root} childrenOf={childrenOf} note={note} seen={new Set()} />
          </li>
        ))}
      </ol>
    </div>
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
        <p className="flex items-center gap-2 text-[15px] font-medium text-text">
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
