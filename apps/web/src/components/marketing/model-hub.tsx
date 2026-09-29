/**
 * ModelHub — Interactive AI Router Diagram
 *
 * Features:
 * - 6 model cards arranged radially around a central hub
 * - Magnetic repulsion on cursor proximity (cards push away gently)
 * - Proximity-based activation: nearest card glows + line pulses
 * - Idle breathing animation when mouse is absent
 * - Spring-physics via rAF (no external lib needed)
 * - Mobile: 2×3 grid fallback
 */

import { useEffect, useRef, useCallback, useState } from 'react';
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

// ─── Config ────────────────────────────────────────────────────────────────

const SVG_W = 520;
const SVG_H = 480;
const CX = SVG_W / 2;   // 260
const CY = SVG_H / 2;   // 240

/** Orbital radius (px in SVG space) */
const ORBIT_R = 200;

/** Magnetic repulsion params */
const REPEL_RADIUS = 150;  // px in DOM space
const REPEL_MAX    = 18;   // max displacement px

/** Spring constants */
const SPRING_K    = 0.14;
const SPRING_DAMP = 0.72;

/** Idle float amplitude */
const IDLE_AMP   = 1.4;
const IDLE_SCALE = 0.012;

// ─── Model definitions ─────────────────────────────────────────────────────

interface ModelDef {
  id: string;
  name: string;
  tag: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  /** deg from top (0 = 12-o'clock), clockwise */
  angleDeg: number;
}

const MODELS: ModelDef[] = [
  {
    id: 'gpt',
    name: 'GPT-6',
    tag: 'Astra',
    desc: 'Reasoning · Coding',
    icon: OpenAiIcon,
    iconColor: '#10b981',   // emerald-500
    angleDeg: 0,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    tag: 'Flash 3.8',
    desc: 'Multimodal · Search',
    icon: GeminiIcon,
    iconColor: '#3b82f6',   // blue-500
    angleDeg: 60,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tag: 'v4.1 Flash',
    desc: 'Reasoning · Coding',
    icon: DeepSeekIcon,
    iconColor: '#38bdf8',   // sky-400
    angleDeg: 120,
  },
  {
    id: 'qwen',
    name: 'Qwen',
    tag: '3.8 Max',
    desc: 'Coding · Open source',
    icon: QwenIcon,
    iconColor: '#a78bfa',   // violet-400
    angleDeg: 180,
  },
  {
    id: 'grok',
    name: 'Grok',
    tag: '4.7',
    desc: 'Reasoning · Real-time',
    icon: GrokIcon,
    iconColor: '#d4d4d8',   // zinc-300
    angleDeg: 240,
  },
  {
    id: 'claude',
    name: 'Claude',
    tag: 'Fable 5.1',
    desc: 'Writing · Analysis',
    icon: ClaudeIcon,
    iconColor: '#fb923c',   // orange-400
    angleDeg: 300,
  },
];

/** Compute SVG anchor of a model */
function svgPos(angleDeg: number, r = ORBIT_R): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

// ─── Spring state per node ──────────────────────────────────────────────────

interface Spring {
  x: number; vx: number;
  y: number; vy: number;
}

function makeSpring(): Spring {
  return { x: 0, vx: 0, y: 0, vy: 0 };
}

function stepSpring(s: Spring, targetX: number, targetY: number): Spring {
  const ax = (targetX - s.x) * SPRING_K;
  const ay = (targetY - s.y) * SPRING_K;
  const vx = (s.vx + ax) * SPRING_DAMP;
  const vy = (s.vy + ay) * SPRING_DAMP;
  return { x: s.x + vx, vx, y: s.y + vy, vy };
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ModelHub({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Per-model spring offset state (parallel arrays for perf)
  const springs   = useRef<Spring[]>(MODELS.map(makeSpring));
  const mousePos   = useRef<{ x: number; y: number } | null>(null);
  const rafId      = useRef<number>(0);
  const idleTime   = useRef<number>(0);
  const mouseActive = useRef<boolean>(false);

  // React state only for things that affect DOM visibility
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [hasHover, setHasHover]   = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>(MODELS.map(() => null));
  const svgRef   = useRef<SVGSVGElement>(null);

  // Current rendered offsets (DOM-px, matching the SVG viewBox scale factor)
  const renderOffsets = useRef<{ x: number; y: number }[]>(MODELS.map(() => ({ x: 0, y: 0 })));

  // ── Animation loop ───────────────────────────────────────────────────────
  const tick = useCallback((now: number) => {
    const container = containerRef.current;
    if (!container) { rafId.current = requestAnimationFrame(tick); return; }

    const rect = container.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;

    // Idle phase (seconds)
    const t = now / 1000;

    let closestDist = Infinity;
    let closestIdx  = -1;

    MODELS.forEach((m, i) => {
      const base = svgPos(m.angleDeg);

      // Cursor position in SVG space
      let targetX = 0;
      let targetY = 0;

      if (mousePos.current) {
        const mx = (mousePos.current.x - rect.left) * scaleX;
        const my = (mousePos.current.y - rect.top) * scaleY;

        // Distance from cursor to base SVG position
        const dx = base.x - mx;
        const dy = base.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Track closest card
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx  = i;
        }

        if (dist < REPEL_RADIUS && dist > 0.5) {
          const strength = (1 - dist / REPEL_RADIUS);
          const pushLen  = strength * strength * REPEL_MAX;
          targetX = (dx / dist) * pushLen;
          targetY = (dy / dist) * pushLen;
        }
      } else {
        // Idle float
        const phase = (i / MODELS.length) * Math.PI * 2;
        targetX = Math.sin(t * 0.7 + phase) * IDLE_AMP;
        targetY = Math.cos(t * 0.5 + phase + 1) * IDLE_AMP;
      }

      springs.current[i] = stepSpring(springs.current[i], targetX, targetY);
      renderOffsets.current[i] = { x: springs.current[i].x, y: springs.current[i].y };
    });

    // Update DOM transforms directly (bypass React reconciler for perf)
    MODELS.forEach((_, i) => {
      const card = cardRefs.current[i];
      if (!card) return;
      const ox = renderOffsets.current[i].x;
      const oy = renderOffsets.current[i].y;

      // Idle scale pulse
      const phase = (i / MODELS.length) * Math.PI * 2;
      const idleS = mousePos.current ? 1 : 1 + Math.sin(t * 0.9 + phase) * IDLE_SCALE;

      const isActive = closestIdx === i && hasHover;
      const scale    = isActive ? 1.08 : idleS;
      const opacity  = hasHover ? (isActive ? 1 : 0.52) : 1;

      // Convert SVG px offset → DOM px (via scale factor)
      const domOx = ox / scaleX;
      const domOy = oy / scaleY;

      card.style.transform = `translate(-50%, -50%) translate(${domOx}px, ${domOy}px) scale(${scale})`;
      card.style.opacity   = String(opacity);

      // Card glow
      if (isActive) {
        card.style.boxShadow  = '0 0 24px rgba(16,185,129,0.28), 0 0 8px rgba(16,185,129,0.18), inset 0 0 0 1px rgba(16,185,129,0.45)';
        card.style.borderColor = 'rgba(16,185,129,0.55)';
      } else {
        card.style.boxShadow  = '';
        card.style.borderColor = '';
      }
    });

    // Update SVG lines
    if (svgRef.current) {
      const lines     = svgRef.current.querySelectorAll<SVGLineElement>('[data-active-line]');
      const flowLines = svgRef.current.querySelectorAll<SVGLineElement>('[data-flow-line]');
      const baseLines = svgRef.current.querySelectorAll<SVGLineElement>('[data-base-line]');

      lines.forEach((line, i) => {
        const base = svgPos(MODELS[i].angleDeg);
        const ox = renderOffsets.current[i].x;
        const oy = renderOffsets.current[i].y;
        line.setAttribute('x1', String(base.x + ox));
        line.setAttribute('y1', String(base.y + oy));
      });

      flowLines.forEach((line, i) => {
        const base = svgPos(MODELS[i].angleDeg);
        const ox = renderOffsets.current[i].x;
        const oy = renderOffsets.current[i].y;
        line.setAttribute('x1', String(base.x + ox));
        line.setAttribute('y1', String(base.y + oy));

        const isActive = closestIdx === i && hasHover;
        line.style.opacity = isActive ? '1' : '0';
      });

      baseLines.forEach((line, i) => {
        const base = svgPos(MODELS[i].angleDeg);
        const ox = renderOffsets.current[i].x;
        const oy = renderOffsets.current[i].y;
        line.setAttribute('x1', String(base.x + ox));
        line.setAttribute('y1', String(base.y + oy));
        const isActive = closestIdx === i && hasHover;
        line.style.opacity = isActive ? '0.12' : '0.35';
      });
    }

    // Update center hub
    const hub = containerRef.current?.querySelector<HTMLDivElement>('[data-hub]');
    if (hub) {
      const isAnyActive = hasHover && closestIdx >= 0;
      const hubScale = mousePos.current ? 1.03 : 1;
      hub.style.transform  = `translate(-50%, -50%) scale(${hubScale})`;
      hub.style.boxShadow  = isAnyActive
        ? '0 0 40px rgba(16,185,129,0.35), 0 0 80px rgba(16,185,129,0.12)'
        : mousePos.current
          ? '0 0 24px rgba(16,185,129,0.18)'
          : '';
    }

    // Update active ID for React state (debounced to avoid thrashing)
    const newActiveId = hasHover && closestIdx >= 0 ? MODELS[closestIdx].id : null;
    if (newActiveId !== activeId) {
      setActiveId(newActiveId);
    }

    rafId.current = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHover]);

  useEffect(() => {
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [tick]);

  // ── Mouse handlers ───────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY };
    mouseActive.current = true;
    idleTime.current = 0;
  }, []);

  const handleMouseEnter = useCallback(() => setHasHover(true), []);
  const handleMouseLeave = useCallback(() => {
    mousePos.current = null;
    mouseActive.current = false;
    setHasHover(false);
    setActiveId(null);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('mousemove', handleMouseMove);
    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      el.removeEventListener('mousemove', handleMouseMove);
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [handleMouseMove, handleMouseEnter, handleMouseLeave]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={cn('w-full flex items-center justify-center', className)}>

      {/* ── Mobile: 2×3 card grid ─────────────────────────────────────────── */}
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

      {/* ── Desktop: interactive radial hub ────────────────────────────────── */}
      <div
        ref={containerRef}
        className="relative hidden sm:block w-full max-w-[520px]"
        style={{ aspectRatio: `${SVG_W} / ${SVG_H}` }}
      >
        {/* SVG layer: lines + rings */}
        <svg
          ref={svgRef}
          className="absolute inset-0 size-full pointer-events-none"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          fill="none"
          style={{ overflow: 'visible' }}
        >
          <defs>
            {/* Neon gradient for active lines */}
            <filter id="neon-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Orbit ring gradient */}
            <radialGradient id="ring-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#10b981" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </radialGradient>

            {/* Animated dash: "marching ants" effect on active line */}
            {MODELS.map((m) => (
              <marker key={`dot-${m.id}`} id={`dot-${m.id}`} refX="3" refY="3" markerWidth="6" markerHeight="6">
                <circle cx="3" cy="3" r="2" fill="#10b981" />
              </marker>
            ))}
          </defs>

          {/* Glow background for center */}
          <circle cx={CX} cy={CY} r={90} fill="url(#ring-grad)" />

          {/* Outer decorative orbit ring */}
          <circle
            cx={CX} cy={CY} r={ORBIT_R + 18}
            stroke="rgba(16,185,129,0.07)"
            strokeWidth={1}
            strokeDasharray="3 5"
          />

          {/* Inner decorative ring */}
          <circle
            cx={CX} cy={CY} r={ORBIT_R - 28}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={1}
            strokeDasharray="1 6"
          />

          {/* Per-model: base dashed line + active neon line + flow animated line */}
          {MODELS.map((m, i) => {
            const base = svgPos(m.angleDeg);
            return (
              <g key={m.id}>
                {/* Base dashed dim line */}
                <line
                  data-base-line
                  x1={base.x}
                  y1={base.y}
                  x2={CX}
                  y2={CY}
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={1}
                  strokeDasharray="3 5"
                  style={{ transition: 'opacity 0.3s ease' }}
                />

                {/* Neon active line */}
                <line
                  data-active-line
                  x1={base.x}
                  y1={base.y}
                  x2={CX}
                  y2={CY}
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeDasharray="3 5"
                  filter="url(#neon-glow)"
                  style={{ opacity: 0, transition: 'opacity 0.25s ease' }}
                />

                {/* Flow dots: animated marching ants */}
                <line
                  data-flow-line
                  x1={base.x}
                  y1={base.y}
                  x2={CX}
                  y2={CY}
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="4 18"
                  strokeLinecap="round"
                  filter="url(#neon-glow)"
                  style={{
                    opacity: 0,
                    animationDelay: `${i * 0.18}s`,
                    strokeDashoffset: 0,
                    animation: 'hub-flow 1.4s linear infinite',
                  }}
                />
              </g>
            );
          })}
        </svg>

        {/* ── Central Hub ───────────────────────────────────────────────────── */}
        <div
          data-hub
          className="absolute z-10"
          style={{
            left: `${(CX / SVG_W) * 100}%`,
            top: `${(CY / SVG_H) * 100}%`,
            transform: 'translate(-50%, -50%)',
            transformOrigin: 'center center',
            transition: 'transform 0.15s ease, box-shadow 0.3s ease',
            willChange: 'transform, box-shadow',
          }}
        >
          <div
            className="relative flex flex-col items-center justify-center select-none"
            style={{
              width: 100,
              height: 100,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 40% 35%, #1e2a23, #111815)',
              border: '1px solid rgba(16,185,129,0.30)',
            }}
          >
            {/* Inner glow ring */}
            <div
              style={{
                position: 'absolute',
                inset: 4,
                borderRadius: '50%',
                border: '1px solid rgba(16,185,129,0.12)',
                pointerEvents: 'none',
              }}
            />
            <img
              src="/logo-mark.png"
              alt="Ketner AI"
              className="size-9 object-contain"
              style={{ filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.6))' }}
            />
            <span
              className="mt-1.5 font-mono uppercase tracking-widest"
              style={{ fontSize: 8, color: 'rgba(16,185,129,0.7)', letterSpacing: '0.12em' }}
            >
              KETNER AI
            </span>
          </div>
        </div>

        {/* ── Model Cards ───────────────────────────────────────────────────── */}
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
                top: `${(base.y / SVG_H) * 100}%`,
                transform: 'translate(-50%, -50%)',
                transformOrigin: 'center center',
                transition:
                  'opacity 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease',
                willChange: 'transform, opacity',
              }}
            >
              <div
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 whitespace-nowrap select-none"
                style={{
                  background: 'rgba(15, 23, 18, 0.75)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.45)',
                }}
              >
                {/* Icon bubble */}
                <div
                  className="grid size-7 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: `${m.iconColor}14`,
                    color: m.iconColor,
                    border: `1px solid ${m.iconColor}30`,
                  }}
                >
                  <Icon className="size-4" />
                </div>

                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-text">{m.name}</span>
                    <span
                      className="font-mono text-[10px] px-1.5 py-0 rounded"
                      style={{
                        color: m.iconColor,
                        background: `${m.iconColor}16`,
                        border: `1px solid ${m.iconColor}28`,
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

      {/* ── Global keyframes injected via style tag ─────────────────────────── */}
      <style>{`
        @keyframes hub-flow {
          to { stroke-dashoffset: -22; }
        }
      `}</style>
    </div>
  );
}
