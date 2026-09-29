/**
 * ModelHub — Interactive AI Router Diagram
 *
 * Features:
 * - 6 model cards arranged radially around a central hub
 * - Magnetic repulsion: cards smoothly push away from cursor
 * - Idle breathing animation when mouse is absent
 * - Spring-physics via rAF (no external lib)
 * - Mobile: 2×3 grid fallback
 */

import { useEffect, useRef, useCallback } from 'react';
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

// ─── Config ─────────────────────────────────────────────────────────────────

const SVG_W = 520;
const SVG_H = 480;
const CX = SVG_W / 2;
const CY = SVG_H / 2;

const ORBIT_R = 200;

/** Repulsion field radius in SVG-space px */
const REPEL_RADIUS = 320;
/** Max displacement in SVG-space px */
const REPEL_MAX = 22;

/** Spring */
const SPRING_K    = 0.12;
const SPRING_DAMP = 0.74;

/** Idle float */
const IDLE_AMP   = 1.6;
const IDLE_SCALE = 0.010;

// ─── Model definitions ────────────────────────────────────────────────────────

interface ModelDef {
  id: string;
  name: string;
  tag: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  angleDeg: number;
}

const MODELS: ModelDef[] = [
  {
    id: 'gpt',
    name: 'GPT-6',
    tag: 'Astra',
    desc: 'Reasoning · Coding',
    icon: OpenAiIcon,
    iconColor: '#10b981',
    angleDeg: 0,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    tag: 'Flash 3.8',
    desc: 'Multimodal · Search',
    icon: GeminiIcon,
    iconColor: '#3b82f6',
    angleDeg: 60,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tag: 'v4.1 Flash',
    desc: 'Reasoning · Coding',
    icon: DeepSeekIcon,
    iconColor: '#38bdf8',
    angleDeg: 120,
  },
  {
    id: 'qwen',
    name: 'Qwen',
    tag: '3.8 Max',
    desc: 'Coding · Open source',
    icon: QwenIcon,
    iconColor: '#a78bfa',
    angleDeg: 180,
  },
  {
    id: 'grok',
    name: 'Grok',
    tag: '4.7',
    desc: 'Reasoning · Real-time',
    icon: GrokIcon,
    iconColor: '#d4d4d8',
    angleDeg: 240,
  },
  {
    id: 'claude',
    name: 'Claude',
    tag: 'Fable 5.1',
    desc: 'Writing · Analysis',
    icon: ClaudeIcon,
    iconColor: '#fb923c',
    angleDeg: 300,
  },
];

function svgPos(angleDeg: number, r = ORBIT_R) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

// ─── Spring ──────────────────────────────────────────────────────────────────

interface Spring { x: number; vx: number; y: number; vy: number; }

const makeSpring = (): Spring => ({ x: 0, vx: 0, y: 0, vy: 0 });

function stepSpring(s: Spring, tx: number, ty: number): Spring {
  const vx = (s.vx + (tx - s.x) * SPRING_K) * SPRING_DAMP;
  const vy = (s.vy + (ty - s.y) * SPRING_K) * SPRING_DAMP;
  return { x: s.x + vx, vx, y: s.y + vy, vy };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ModelHub({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const springs      = useRef<Spring[]>(MODELS.map(makeSpring));
  const offsets      = useRef(MODELS.map(() => ({ x: 0, y: 0 })));
  const mousePos     = useRef<{ x: number; y: number } | null>(null);
  const rafId        = useRef<number>(0);
  const cardRefs     = useRef<(HTMLDivElement | null)[]>(MODELS.map(() => null));
  const svgRef       = useRef<SVGSVGElement>(null);

  // ── rAF tick ───────────────────────────────────────────────────────────────
  const tick = useCallback((now: number) => {
    const container = containerRef.current;
    if (!container) { rafId.current = requestAnimationFrame(tick); return; }

    const rect   = container.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;
    const t      = now / 1000;

    MODELS.forEach((m, i) => {
      const base = svgPos(m.angleDeg);
      let tx = 0, ty = 0;

      if (mousePos.current) {
        // Convert cursor to SVG space
        const mx = (mousePos.current.x - rect.left) * scaleX;
        const my = (mousePos.current.y - rect.top)  * scaleY;
        const dx = base.x - mx;
        const dy = base.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < REPEL_RADIUS && dist > 0.5) {
          const t2      = 1 - dist / REPEL_RADIUS;
          const pushLen = t2 * t2 * REPEL_MAX;
          tx = (dx / dist) * pushLen;
          ty = (dy / dist) * pushLen;
        }
      } else {
        // Idle float
        const phase = (i / MODELS.length) * Math.PI * 2;
        tx = Math.sin(t * 0.7 + phase) * IDLE_AMP;
        ty = Math.cos(t * 0.5 + phase + 1) * IDLE_AMP;
      }

      springs.current[i] = stepSpring(springs.current[i], tx, ty);
      offsets.current[i] = { x: springs.current[i].x, y: springs.current[i].y };
    });

    // ── DOM writes ─────────────────────────────────────────────────────────

    MODELS.forEach((_, i) => {
      const card = cardRefs.current[i];
      if (!card) return;

      const ox = offsets.current[i].x / scaleX;
      const oy = offsets.current[i].y / scaleY;

      // Idle scale breathe (stops when mouse is present)
      const phase = (i / MODELS.length) * Math.PI * 2;
      const scale = mousePos.current
        ? 1
        : 1 + Math.sin(t * 0.9 + phase) * IDLE_SCALE;

      card.style.transform = `translate(-50%, -50%) translate(${ox}px, ${oy}px) scale(${scale})`;
    });

    // ── SVG lines: track card offsets ──────────────────────────────────────
    if (svgRef.current) {
      svgRef.current.querySelectorAll<SVGLineElement>('[data-line]').forEach((line, i) => {
        const base = svgPos(MODELS[i].angleDeg);
        line.setAttribute('x1', String(base.x + offsets.current[i].x));
        line.setAttribute('y1', String(base.y + offsets.current[i].y));
      });
    }

    rafId.current = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [tick]);

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  const onMove  = useCallback((e: MouseEvent) => { mousePos.current = { x: e.clientX, y: e.clientY }; }, []);
  const onLeave = useCallback(() => { mousePos.current = null; }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [onMove, onLeave]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={cn('w-full flex items-center justify-center', className)}>

      {/* Mobile: 2×3 grid */}
      <div className="grid grid-cols-2 gap-2.5 w-full sm:hidden">
        {MODELS.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.id}
              className="flex items-center gap-2.5 rounded-lg border border-stroke bg-surface p-2.5 transition-colors hover:border-stroke-strong"
            >
              <div
                className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-2"
                style={{ color: m.iconColor }}
              >
                <Icon className="size-3.5" />
              </div>
              <div className="min-w-0 text-left">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-text truncate">{m.name}</span>
                  <Badge tone="neutral" className="text-[9px] px-1 py-0">{m.tag}</Badge>
                </div>
                <p className="text-[10px] text-subtle truncate">{m.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: radial hub */}
      <div
        ref={containerRef}
        className="relative hidden sm:block w-full max-w-[520px]"
        style={{ aspectRatio: `${SVG_W} / ${SVG_H}` }}
      >
        {/* SVG: decorative rings + dashed lines */}
        <svg
          ref={svgRef}
          className="absolute inset-0 size-full pointer-events-none"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          fill="none"
          style={{ overflow: 'visible' }}
        >
          {/* Soft centre glow */}
          <circle cx={CX} cy={CY} r={80} fill="rgba(16,185,129,0.04)" />

          {/* Outer orbit ring */}
          <circle
            cx={CX} cy={CY} r={ORBIT_R + 16}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={1}
            strokeDasharray="3 6"
          />
          {/* Inner ring */}
          <circle
            cx={CX} cy={CY} r={ORBIT_R - 30}
            stroke="rgba(255,255,255,0.03)"
            strokeWidth={1}
            strokeDasharray="1 8"
          />

          {/* Dashed lines — updated each frame via data-line attr */}
          {MODELS.map((m) => {
            const base = svgPos(m.angleDeg);
            return (
              <line
                key={m.id}
                data-line
                x1={base.x}
                y1={base.y}
                x2={CX}
                y2={CY}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={1}
                strokeDasharray="3 6"
              />
            );
          })}
        </svg>

        {/* Central hub */}
        <div
          className="absolute z-10"
          style={{
            left: `${(CX / SVG_W) * 100}%`,
            top:  `${(CY / SVG_H) * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div
            className="relative flex flex-col items-center justify-center select-none"
            style={{
              width: 96,
              height: 96,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 40% 35%, #1c2820, #101510)',
              border: '1px solid rgba(16,185,129,0.22)',
              boxShadow: '0 0 0 1px rgba(16,185,129,0.07) inset',
            }}
          >
            <img
              src="/logo-mark.png"
              alt="Ketner AI"
              className="size-8 object-contain"
              style={{ filter: 'drop-shadow(0 0 5px rgba(16,185,129,0.5))' }}
            />
            <span
              className="mt-1 font-mono uppercase"
              style={{ fontSize: 7.5, color: 'rgba(16,185,129,0.60)', letterSpacing: '0.11em' }}
            >
              KETNER AI
            </span>
          </div>
        </div>

        {/* Model cards */}
        {MODELS.map((m, i) => {
          const Icon = m.icon;
          const base = svgPos(m.angleDeg);
          return (
            <div
              key={m.id}
              ref={(el) => { cardRefs.current[i] = el; }}
              className="absolute z-20"
              style={{
                left: `${(base.x / SVG_W) * 100}%`,
                top:  `${(base.y / SVG_H) * 100}%`,
                transform: 'translate(-50%, -50%)',
                transformOrigin: 'center center',
                willChange: 'transform',
              }}
            >
              <div
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 whitespace-nowrap select-none"
                style={{
                  background: 'rgba(13, 20, 15, 0.72)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 2px 14px rgba(0,0,0,0.5)',
                }}
              >
                <div
                  className="grid size-7 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: `${m.iconColor}12`,
                    color: m.iconColor,
                    border: `1px solid ${m.iconColor}28`,
                  }}
                >
                  <Icon className="size-4" />
                </div>

                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-text">{m.name}</span>
                    <span
                      className="font-mono text-[10px] px-1.5 rounded"
                      style={{
                        color: m.iconColor,
                        background: `${m.iconColor}14`,
                        border: `1px solid ${m.iconColor}24`,
                      }}
                    >
                      {m.tag}
                    </span>
                  </div>
                  <p className="text-[10px] text-subtle mt-0.5">{m.desc}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
