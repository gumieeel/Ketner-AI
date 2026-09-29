/**
 * ModelHub — Orbital Particle Physics
 *
 * Each card has a real SVG-space position that evolves each frame:
 *   F = spring-to-home + cursor-repulsion + card-card-repulsion
 * Velocity is integrated with damping. Cards return to orbit when cursor leaves.
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

// ─── SVG canvas ──────────────────────────────────────────────────────────────

const SVG_W   = 520;
const SVG_H   = 480;
const CX      = SVG_W / 2;
const CY      = SVG_H / 2;
const ORBIT_R = 200;

// ─── Physics constants ───────────────────────────────────────────────────────

/** How strongly each card springs back to its home orbit position */
const SPRING_K         = 0.055;
/** Velocity damping per frame (closer to 1 = less damping = more floaty) */
const DAMPING          = 0.90;
/** Max speed a card can travel (SVG-px / frame) */
const MAX_SPEED        = 7;

/** Cursor repulsion: radius in SVG-px and peak force scalar */
const CURSOR_REPEL_R   = 240;
const CURSOR_REPEL_STR = 700;

/** Card–card repulsion: radius in SVG-px and peak force scalar */
const CARD_REPEL_R     = 115;
const CARD_REPEL_STR   = 260;

/** Gentle idle drift force amplitude (applied when no cursor) */
const IDLE_FORCE       = 0.28;

// ─── Models ──────────────────────────────────────────────────────────────────

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
  { id: 'gpt',      name: 'GPT-6',    tag: 'Astra',    desc: 'Reasoning · Coding',     icon: OpenAiIcon,  iconColor: '#10b981', angleDeg: 0   },
  { id: 'gemini',   name: 'Gemini',   tag: 'Flash 3.8',desc: 'Multimodal · Search',    icon: GeminiIcon,  iconColor: '#3b82f6', angleDeg: 60  },
  { id: 'deepseek', name: 'DeepSeek', tag: 'v4.1 Flash',desc:'Reasoning · Coding',     icon: DeepSeekIcon,iconColor: '#38bdf8', angleDeg: 120 },
  { id: 'qwen',     name: 'Qwen',     tag: '3.8 Max',  desc: 'Coding · Open source',   icon: QwenIcon,    iconColor: '#a78bfa', angleDeg: 180 },
  { id: 'grok',     name: 'Grok',     tag: '4.7',      desc: 'Reasoning · Real-time',  icon: GrokIcon,    iconColor: '#d4d4d8', angleDeg: 240 },
  { id: 'claude',   name: 'Claude',   tag: 'Fable 5.1',desc: 'Writing · Analysis',     icon: ClaudeIcon,  iconColor: '#fb923c', angleDeg: 300 },
];

function orbitPos(angleDeg: number, r = ORBIT_R) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

/** Pre-computed home positions in SVG space */
const HOME = MODELS.map(m => orbitPos(m.angleDeg));

// ─── Vec2 helpers ─────────────────────────────────────────────────────────────

type Vec2 = { x: number; y: number };
const len  = (v: Vec2) => Math.sqrt(v.x * v.x + v.y * v.y);
const clampSpeed = (v: Vec2, max: number): Vec2 => {
  const s = len(v);
  return s > max ? { x: v.x / s * max, y: v.y / s * max } : v;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function ModelHub({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs     = useRef<(HTMLDivElement | null)[]>(MODELS.map(() => null));
  const svgRef       = useRef<SVGSVGElement>(null);
  const rafId        = useRef<number>(0);

  // Physics state — actual SVG-space positions and velocities
  const pos = useRef<Vec2[]>(MODELS.map((_, i) => ({ ...HOME[i] })));
  const vel = useRef<Vec2[]>(MODELS.map(() => ({ x: 0, y: 0 })));

  // Cursor state in client-px (null = outside component)
  const cursor = useRef<Vec2 | null>(null);

  // ── Main physics + render loop ──────────────────────────────────────────────
  const tick = useCallback((now: number) => {
    const container = containerRef.current;
    if (!container) { rafId.current = requestAnimationFrame(tick); return; }

    const rect   = container.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;
    const t      = now / 1000;

    // Cursor in SVG space
    const mx = cursor.current ? (cursor.current.x - rect.left) * scaleX : null;
    const my = cursor.current ? (cursor.current.y - rect.top)  * scaleY : null;

    // ── Physics ────────────────────────────────────────────────────────────────
    for (let i = 0; i < MODELS.length; i++) {
      const p = pos.current[i];
      const v = vel.current[i];
      const h = HOME[i];

      // 1. Spring back to home orbit position
      let fx = (h.x - p.x) * SPRING_K;
      let fy = (h.y - p.y) * SPRING_K;

      // 2. Cursor repulsion
      if (mx !== null && my !== null) {
        const dx = p.x - mx;
        const dy = p.y - my;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < CURSOR_REPEL_R && d > 1) {
          const falloff = 1 - d / CURSOR_REPEL_R;
          const str     = falloff * falloff * CURSOR_REPEL_STR / d;
          fx += dx * str;
          fy += dy * str;
        }
      } else {
        // Gentle idle drift when cursor absent
        const phase = (i / MODELS.length) * Math.PI * 2;
        fx += Math.sin(t * 0.45 + phase) * IDLE_FORCE;
        fy += Math.cos(t * 0.35 + phase + 1.2) * IDLE_FORCE;
      }

      // 3. Card–card repulsion
      for (let j = 0; j < MODELS.length; j++) {
        if (j === i) continue;
        const o  = pos.current[j];
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < CARD_REPEL_R && d > 1) {
          const falloff = 1 - d / CARD_REPEL_R;
          const str     = falloff * CARD_REPEL_STR / d;
          fx += dx * str;
          fy += dy * str;
        }
      }

      // 4. Integrate velocity with damping
      v.x = (v.x + fx) * DAMPING;
      v.y = (v.y + fy) * DAMPING;

      // 5. Clamp speed
      const clamped = clampSpeed(v, MAX_SPEED);
      v.x = clamped.x;
      v.y = clamped.y;

      // 6. Update position
      p.x += v.x;
      p.y += v.y;
    }

    // ── DOM writes ─────────────────────────────────────────────────────────────
    for (let i = 0; i < MODELS.length; i++) {
      const card = cardRefs.current[i];
      if (!card) continue;

      const p = pos.current[i];
      const h = HOME[i];

      // Offset from home in DOM px
      const ox = (p.x - h.x) / scaleX;
      const oy = (p.y - h.y) / scaleY;

      card.style.transform = `translate(-50%, -50%) translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`;
    }

    // ── SVG lines follow card positions ────────────────────────────────────────
    if (svgRef.current) {
      const lines = svgRef.current.querySelectorAll<SVGLineElement>('[data-line]');
      lines.forEach((line, i) => {
        const p = pos.current[i];
        line.setAttribute('x1', p.x.toFixed(1));
        line.setAttribute('y1', p.y.toFixed(1));
      });
    }

    rafId.current = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [tick]);

  // ── Mouse events ───────────────────────────────────────────────────────────
  const onMove  = useCallback((e: MouseEvent) => { cursor.current = { x: e.clientX, y: e.clientY }; }, []);
  const onLeave = useCallback(() => { cursor.current = null; }, []);

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
              <div className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-2" style={{ color: m.iconColor }}>
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

      {/* Desktop: physics hub */}
      <div
        ref={containerRef}
        className="relative hidden sm:block w-full max-w-[520px]"
        style={{ aspectRatio: `${SVG_W} / ${SVG_H}` }}
      >
        {/* SVG: decorative rings + lines */}
        <svg
          ref={svgRef}
          className="absolute inset-0 size-full pointer-events-none"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          fill="none"
          style={{ overflow: 'visible' }}
        >
          {/* Soft centre glow */}
          <circle cx={CX} cy={CY} r={80} fill="rgba(16,185,129,0.04)" />

          {/* Decorative orbit rings */}
          <circle cx={CX} cy={CY} r={ORBIT_R + 18} stroke="rgba(255,255,255,0.05)" strokeWidth={1} strokeDasharray="3 7" />
          <circle cx={CX} cy={CY} r={ORBIT_R - 28} stroke="rgba(255,255,255,0.03)" strokeWidth={1} strokeDasharray="1 9" />

          {/* Lines from each card to centre — x1/y1 updated by rAF */}
          {MODELS.map((m, i) => (
            <line
              key={m.id}
              data-line
              x1={HOME[i].x}
              y1={HOME[i].y}
              x2={CX}
              y2={CY}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
              strokeDasharray="3 6"
            />
          ))}
        </svg>

        {/* Central hub — static */}
        <div
          className="absolute z-10"
          style={{ left: `${(CX / SVG_W) * 100}%`, top: `${(CY / SVG_H) * 100}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div
            className="relative flex flex-col items-center justify-center select-none"
            style={{
              width: 96, height: 96,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 40% 35%, #1c2820, #101510)',
              border: '1px solid rgba(16,185,129,0.22)',
              boxShadow: '0 0 0 1px rgba(16,185,129,0.07) inset',
            }}
          >
            <img src="/logo-mark.png" alt="Ketner AI" className="size-8 object-contain"
              style={{ filter: 'drop-shadow(0 0 5px rgba(16,185,129,0.5))' }}
            />
            <span className="mt-1 font-mono uppercase"
              style={{ fontSize: 7.5, color: 'rgba(16,185,129,0.60)', letterSpacing: '0.11em' }}
            >
              KETNER AI
            </span>
          </div>
        </div>

        {/* Model cards — left/top anchored at HOME, transform moved by rAF */}
        {MODELS.map((m, i) => {
          const Icon = m.icon;
          return (
            <div
              key={m.id}
              ref={(el) => { cardRefs.current[i] = el; }}
              className="absolute z-20"
              style={{
                left: `${(HOME[i].x / SVG_W) * 100}%`,
                top:  `${(HOME[i].y / SVG_H) * 100}%`,
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
                  style={{ background: `${m.iconColor}12`, color: m.iconColor, border: `1px solid ${m.iconColor}28` }}
                >
                  <Icon className="size-4" />
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-text">{m.name}</span>
                    <span
                      className="font-mono text-[10px] px-1.5 rounded"
                      style={{ color: m.iconColor, background: `${m.iconColor}14`, border: `1px solid ${m.iconColor}24` }}
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
