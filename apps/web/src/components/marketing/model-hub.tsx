import {
  OpenAiIcon,
  ClaudeIcon,
  GeminiIcon,
  DeepSeekIcon,
  QwenIcon,
  GrokIcon,
} from '@/components/icons/brands';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

interface ModelNode {
  id: string;
  name: string;
  tag: string;
  desc: string;
  x: number;
  y: number;
  percentX: number;
  percentY: number;
  icon: typeof OpenAiIcon;
  iconColor: string;
}

const NODES: ModelNode[] = [
  {
    id: 'gpt',
    name: 'GPT-6',
    tag: 'Astra',
    desc: 'Reasoning · Coding',
    x: 240,
    y: 40,
    percentX: 50,
    percentY: 9,
    icon: OpenAiIcon,
    iconColor: 'text-emerald-500',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    tag: 'Flash 3.8',
    desc: 'Multimodal · Search',
    x: 400,
    y: 80,
    percentX: 83,
    percentY: 18,
    icon: GeminiIcon,
    iconColor: 'text-blue-500',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tag: 'v4.1 Flash',
    desc: 'Reasoning · Coding',
    x: 400,
    y: 370,
    percentX: 83,
    percentY: 82,
    icon: DeepSeekIcon,
    iconColor: 'text-sky-400',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    tag: '3.8 Max',
    desc: 'Coding · Open source',
    x: 240,
    y: 410,
    percentX: 50,
    percentY: 91,
    icon: QwenIcon,
    iconColor: 'text-purple-400',
  },
  {
    id: 'grok',
    name: 'Grok',
    tag: '4.7',
    desc: 'Reasoning · Real-time',
    x: 80,
    y: 370,
    percentX: 17,
    percentY: 82,
    icon: GrokIcon,
    iconColor: 'text-zinc-200',
  },
  {
    id: 'claude',
    name: 'Claude',
    tag: 'Fable 5.1',
    desc: 'Writing · Analysis',
    x: 80,
    y: 80,
    percentX: 17,
    percentY: 18,
    icon: ClaudeIcon,
    iconColor: 'text-orange-400',
  },
];

export function ModelHub({ className }: { className?: string }) {
  return (
    <div className={cn('w-full flex items-center justify-center', className)}>
      {/* 1. Mobile representation: 2x3 Grid (< 640px) */}
      <div className="grid grid-cols-2 gap-2.5 w-full sm:hidden">
        {NODES.map((node) => {
          const Icon = node.icon;
          return (
            <div
              key={node.id}
              className="flex items-center gap-2.5 rounded-lg border border-stroke bg-surface p-2.5 transition-colors hover:border-stroke-strong"
            >
              <div
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-md bg-surface-2',
                  node.iconColor,
                )}
              >
                <Icon className="size-3.5" />
              </div>
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-text truncate">
                    {node.name}
                  </span>
                  <Badge tone="neutral" className="text-[9px] px-1 py-0">
                    {node.tag}
                  </Badge>
                </div>
                <p className="text-[10px] text-subtle truncate">{node.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2. Desktop representation: Circular Hub (>= 640px) */}
      <div className="relative hidden sm:block w-full max-w-[480px] aspect-[480/450]">
        {/* SVG connection lines with animated moving dash */}
        <svg
          className="absolute inset-0 size-full pointer-events-none"
          viewBox="0 0 480 450"
          fill="none"
        >
          {NODES.map((node, i) => (
            <g key={node.id}>
              {/* Base dashed line */}
              <line
                x1={node.x}
                y1={node.y}
                x2={240}
                y2={225}
                stroke="var(--stroke-strong)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              {/* Flow line animation */}
              <line
                x1={node.x}
                y1={node.y}
                x2={240}
                y2={225}
                stroke="var(--accent)"
                strokeWidth={1.5}
                className="flow-line"
                style={{
                  animationDelay: `${i * 0.3}s`,
                }}
              />
            </g>
          ))}
        </svg>

        {/* Outer subtle decorative dashed ring */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 size-[340px] rounded-full border border-dashed border-stroke pointer-events-none" />

        {/* Central Ketner Hub Circle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 size-28 rounded-full border border-stroke-strong bg-surface p-3 flex flex-col items-center justify-center select-none shadow-sm">
          <img
            src="/logo-mark.png"
            alt="Ketner AI"
            className="size-8 object-contain"
          />
          <span className="mt-1 font-mono text-[10px] font-semibold tracking-wider text-muted uppercase">
            KETNER AI
          </span>
        </div>

        {/* 6 Peripheral Model Node Cards */}
        {NODES.map((node) => {
          const Icon = node.icon;
          return (
            <div
              key={node.id}
              style={{
                left: `${node.percentX}%`,
                top: `${node.percentY}%`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 z-20 flex items-center gap-2.5 rounded-lg border border-stroke bg-surface px-3 py-2 transition-colors hover:border-stroke-strong shadow-sm"
            >
              <div
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-md bg-surface-2',
                  node.iconColor,
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-text">
                    {node.name}
                  </span>
                  <Badge tone="neutral" className="text-[10px] px-1 py-0">
                    {node.tag}
                  </Badge>
                </div>
                <p className="text-[10px] text-subtle whitespace-nowrap">
                  {node.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
