/**
 * ModelHub — Planetary Orbital Physics with Edge-to-Edge Frame Collisions
 *
 * Ketner AI sits in the center as the "Sun".
 * 6 model cards orbit around it on an expanded circular track.
 *
 * Physics & Interactions:
 * - When cursor approaches the orbit, cards slide ALONG the circular orbit away from the cursor.
 * - Cards slide until their frames literally collide edge-to-edge (borders physically touch).
 * - Smooth forward momentum transfer: the hitting card pushes the front card forward without violently rebounding backward.
 * - Softer, highly damped home spring for a graceful, floating planetary return.
 * - Multi-pass constraint solver prevents penetration: cards stack flush frame-to-frame without overlapping.
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

// ─── Geometry ────────────────────────────────────────────────────────────────

const SVG_W   = 580;
const SVG_H   = 520;
const CX      = SVG_W / 2;   // 290
const CY      = SVG_H / 2;   // 260
const ORBIT_R = 220;         // Expanded, spacious orbit radius

// Exact physical card dimensions (rendered px)
const CARD_W    = 156;
const CARD_H    = 44;
const CORNER_R  = 12;

// ─── Orbital Physics Constants ───────────────────────────────────────────────

/** Gentle, smooth home angular spring pull (no aggressive snapback) */
const K_HOME_SPRING = 0.024;
/** High angular velocity damping per frame (prevents recoil/oscillations) */
const ANG_DAMPING   = 0.91;
/** Capped maximum angular velocity (radians / frame) */
const MAX_ANG_VEL   = 0.042;

/** Cursor repulsion along the orbit */
const CURSOR_REPEL_RADIUS = 175; // px
const CURSOR_ANG_FORCE    = 0.034;

/** Radial outward compliance when cursor enters orbital axis */
const MAX_RADIAL_PUSH = 15; // px

// ─── Angle math helpers ──────────────────────────────────────────────────────

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ─── Frame-to-Frame Exact Collision Detection ────────────────────────────────

/**
 * Checks whether two rectangular card frames (with rounded corners) are overlapping.
 * Returns { colliding: boolean, penetration: number }
 */
function checkFrameCollision(
  x1: number, y1: number,
  x2: number, y2: number
): { colliding: boolean; penetration: number } {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);

  // Clearance between bounding boxes (negative means overlap)
  const ox = CARD_W - dx;
  const oy = CARD_H - dy;

  if (ox <= 0 || oy <= 0) {
    return { colliding: false, penetration: 0 };
  }

  // Check rounded corner zones
  const flatW = CARD_W - 2 * CORNER_R;
  const flatH = CARD_H - 2 * CORNER_R;

  if (dx > flatW && dy > flatH) {
    const cdx = dx - flatW;
    const cdy = dy - flatH;
    const cornerDist = Math.hypot(cdx, cdy);
    if (cornerDist >= 2 * CORNER_R) {
      return { colliding: false, penetration: 0 };
    }
    return { colliding: true, penetration: 2 * CORNER_R - cornerDist };
  }

  // Minimum overlap depth along X or Y
  const penetration = Math.min(ox, oy);
  return { colliding: true, penetration };
}

// ─── Models Definitions ──────────────────────────────────────────────────────

interface ModelDef {
  id: string;
  name: string;
  tag: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
}

const MODELS: ModelDef[] = [
  { id: 'gpt',      name: 'GPT-6',    tag: 'Astra',     desc: 'Reasoning · Coding',    icon: OpenAiIcon,   iconColor: '#10b981' },
  { id: 'gemini',   name: 'Gemini',   tag: 'Flash 3.8', desc: 'Multimodal · Search',   icon: GeminiIcon,   iconColor: '#3b82f6' },
  { id: 'deepseek', name: 'DeepSeek', tag: 'v4.1 Flash',desc: 'Reasoning · Coding',    icon: DeepSeekIcon, iconColor: '#38bdf8' },
  { id: 'qwen',     name: 'Qwen',     tag: '3.8 Max',   desc: 'Coding · Open source',  icon: QwenIcon,     iconColor: '#a78bfa' },
  { id: 'grok',     name: 'Grok',     tag: '4.7',       desc: 'Reasoning · Real-time', icon: GrokIcon,     iconColor: '#d4d4d8' },
  { id: 'claude',   name: 'Claude',   tag: 'Fable 5.1', desc: 'Writing · Analysis',    icon: ClaudeIcon,   iconColor: '#fb923c' },
];

const N = MODELS.length;

/**
 * 6 home slots evenly spaced around the circle:
 * Slot 0: Top (-pi/2)
 * Slot 1: Top-Right (-pi/6)
 * Slot 2: Bottom-Right (+pi/6)
 * Slot 3: Bottom (+pi/2)
 * Slot 4: Bottom-Left (+5pi/6)
 * Slot 5: Top-Left (+7pi/6)
 */
const HOME_ANGLES = MODELS.map((_, i) => wrapAngle(-Math.PI / 2 + (i * 2 * Math.PI) / N));

// ─── Component ───────────────────────────────────────────────────────────────

export function ModelHub({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs     = useRef<(HTMLDivElement | null)[]>(MODELS.map(() => null));
  const svgRef       = useRef<SVGSVGElement>(null);
  const rafId        = useRef<number>(0);

  // Angles for each model
  const anglesRef = useRef<number[]>([...HOME_ANGLES]);
  const angVelRef = useRef<number[]>(MODELS.map(() => 0));
  const radiusRef = useRef<number[]>(MODELS.map(() => ORBIT_R));

  // Cursor state in client viewport px
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  // ── Physics + Render Loop ──────────────────────────────────────────────────
  const tick = useCallback((now: number) => {
    const container = containerRef.current;
    if (!container) {
      rafId.current = requestAnimationFrame(tick);
      return;
    }

    const rect   = container.getBoundingClientRect();
    const scaleX = SVG_W / rect.width;
    const scaleY = SVG_H / rect.height;
    const time   = now * 0.001;

    // Convert cursor to SVG coordinates
    let mx: number | null = null;
    let my: number | null = null;
    let mAngle: number | null = null;
    let mDistCenter = 0;

    if (cursorRef.current) {
      mx = (cursorRef.current.x - rect.left) * scaleX;
      my = (cursorRef.current.y - rect.top)  * scaleY;
      mDistCenter = Math.hypot(mx - CX, my - CY);
      mAngle = Math.atan2(my - CY, mx - CX);
    }

    const angles = anglesRef.current;
    const angVel = angVelRef.current;
    const radii  = radiusRef.current;

    // ── 1. Calculate Forces per Model ────────────────────────────────────────
    for (let i = 0; i < N; i++) {
      const th = angles[i];
      let netForce = 0;

      // A) Gentle restorative spring to home slot (shortest circular arc)
      const homeDelta = wrapAngle(HOME_ANGLES[i] - th);
      netForce += homeDelta * K_HOME_SPRING;

      // Current Cartesian position of card
      const currR = radii[i];
      const cardX = CX + currR * Math.cos(th);
      const cardY = CY + currR * Math.sin(th);

      let targetRadius = ORBIT_R;

      // B) Cursor repulsion along orbit & radial push
      if (mx !== null && my !== null && mAngle !== null && mDistCenter > 45 && mDistCenter < 380) {
        const distToCursor = Math.hypot(cardX - mx, cardY - my);

        if (distToCursor < CURSOR_REPEL_RADIUS && distToCursor > 0.5) {
          const falloff = 1 - distToCursor / CURSOR_REPEL_RADIUS;
          const pushIntensity = falloff * falloff;

          // Angular separation along the circle
          const angDiff = wrapAngle(th - mAngle);
          // Push clockwise if card is CW of cursor, or counter-clockwise if CCW
          const pushSign = angDiff >= 0 ? 1 : -1;

          netForce += pushSign * pushIntensity * CURSOR_ANG_FORCE;

          // Radial expansion: card flexes slightly outward as cursor enters orbit
          targetRadius = ORBIT_R + pushIntensity * MAX_RADIAL_PUSH;
        }
      } else {
        // C) Idle orbital harmonic drift (gentle breathing)
        const phase = (i * 2 * Math.PI) / N;
        netForce += Math.sin(time * 0.65 + phase) * 0.0014;
      }

      // Smooth radial spring
      radii[i] += (targetRadius - radii[i]) * 0.12;

      // Integrate angular velocity with high damping (prevents harsh rebound)
      angVel[i] = (angVel[i] + netForce) * ANG_DAMPING;
      angVel[i] = Math.max(-MAX_ANG_VEL, Math.min(MAX_ANG_VEL, angVel[i]));
      angles[i] = wrapAngle(angles[i] + angVel[i]);
    }

    // ── 2. All-Pairs Exact Frame Collision Resolution ────────────────────────
    // Multi-pass constraint solver ensures no two cards ever overlap
    for (let iter = 0; iter < 5; iter++) {
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const x1 = CX + radii[i] * Math.cos(angles[i]);
          const y1 = CY + radii[i] * Math.sin(angles[i]);
          const x2 = CX + radii[j] * Math.cos(angles[j]);
          const y2 = CY + radii[j] * Math.sin(angles[j]);

          const { colliding, penetration } = checkFrameCollision(x1, y1, x2, y2);

          if (colliding && penetration > 0) {
            // Find direction from card i to card j along circular orbit
            const angDiff = wrapAngle(angles[j] - angles[i]);
            const dir = angDiff >= 0 ? 1 : -1;
            const angCorrection = (penetration / ORBIT_R) + 0.005;

            // Push cards apart in opposite directions along orbit
            angles[j] = wrapAngle(angles[j] + dir * angCorrection * 0.5);
            angles[i] = wrapAngle(angles[i] - dir * angCorrection * 0.5);

            // Equalize and dampen velocities on contact to prevent sticking
            const avgVel = (angVel[i] + angVel[j]) * 0.5;
            angVel[i] = avgVel * 0.6;
            angVel[j] = avgVel * 0.6;
          }
        }
      }
    }

    // ── 3. DOM Transforms & SVG Line Updates ─────────────────────────────────
    for (let i = 0; i < N; i++) {
      const card = cardRefs.current[i];
      const th = angles[i];
      const r  = radii[i];

      const x = CX + r * Math.cos(th);
      const y = CY + r * Math.sin(th);

      if (card) {
        const domOffsetX = (x - CX) / scaleX;
        const domOffsetY = (y - CY) / scaleY;

        card.style.transform = `translate(-50%, -50%) translate(${domOffsetX.toFixed(2)}px, ${domOffsetY.toFixed(2)}px)`;
      }

      // Update connecting ray from Sun (CX, CY) to Model planet (x, y)
      if (svgRef.current) {
        const line = svgRef.current.querySelector<SVGLineElement>(`[data-line="${MODELS[i].id}"]`);
        if (line) {
          line.setAttribute('x1', x.toFixed(1));
          line.setAttribute('y1', y.toFixed(1));
        }
      }
    }

    rafId.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [tick]);

  // ── Mouse Listeners ────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e: MouseEvent) => {
    cursorRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseLeave = useCallback(() => {
    cursorRef.current = null;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mouseleave', onMouseLeave);
    return () => {
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [onMouseMove, onMouseLeave]);

  return (
    <div className={cn('w-full flex items-center justify-center', className)}>
      {/* ── Mobile: 2×3 card grid fallback ─────────────────────────────────── */}
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

      {/* ── Desktop: Planetary Orbital Hub ─────────────────────────────────── */}
      <div
        ref={containerRef}
        className="relative hidden sm:block w-full max-w-[560px]"
        style={{ aspectRatio: `${SVG_W} / ${SVG_H}` }}
      >
        {/* SVG background: orbital track + radial connector rays */}
        <svg
          ref={svgRef}
          className="absolute inset-0 size-full pointer-events-none"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          fill="none"
          style={{ overflow: 'visible' }}
        >
          {/* Gravitational halo glow around Sun */}
          <circle cx={CX} cy={CY} r={95} fill="rgba(16,185,129,0.05)" />

          {/* Primary circular orbit track */}
          <circle
            cx={CX}
            cy={CY}
            r={ORBIT_R}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
            strokeDasharray="4 6"
          />

          {/* Subtle outer orbit ring */}
          <circle
            cx={CX}
            cy={CY}
            r={ORBIT_R + 26}
            stroke="rgba(16,185,129,0.04)"
            strokeWidth={1}
            strokeDasharray="2 8"
          />

          {/* Rays from Sun (CX, CY) to Model planets */}
          {MODELS.map((m, i) => {
            const th = HOME_ANGLES[i];
            const initX = CX + ORBIT_R * Math.cos(th);
            const initY = CY + ORBIT_R * Math.sin(th);
            return (
              <line
                key={m.id}
                data-line={m.id}
                x1={initX}
                y1={initY}
                x2={CX}
                y2={CY}
                stroke="rgba(255,255,255,0.16)"
                strokeWidth={1}
                strokeDasharray="3 5"
              />
            );
          })}
        </svg>

        {/* ── The Sun: Ketner AI Core Hub (Fixed in the Center) ──────────────── */}
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
              width: 104,
              height: 104,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 40% 35%, #1d2a22, #0b110d)',
              border: '1px solid rgba(16,185,129,0.28)',
              boxShadow: '0 0 35px rgba(16,185,129,0.14), inset 0 0 16px rgba(16,185,129,0.08)',
            }}
          >
            {/* Subtle inner orbital halo ring */}
            <div
              style={{
                position: 'absolute',
                inset: 3,
                borderRadius: '50%',
                border: '1px dashed rgba(16,185,129,0.15)',
                pointerEvents: 'none',
              }}
            />
            <img
              src="/logo-mark.png"
              alt="Ketner AI"
              className="size-8 object-contain"
              style={{ filter: 'drop-shadow(0 0 6px rgba(16,185,129,0.55))' }}
            />
            <span
              className="mt-1 font-mono uppercase"
              style={{ fontSize: 7.5, color: 'rgba(16,185,129,0.7)', letterSpacing: '0.12em' }}
            >
              KETNER AI
            </span>
          </div>
        </div>

        {/* ── Model Planets: Orbiting along the Circular Track ────────────────── */}
        {MODELS.map((m, i) => {
          const Icon = m.icon;
          const th = HOME_ANGLES[i];
          const initX = CX + ORBIT_R * Math.cos(th);
          const initY = CY + ORBIT_R * Math.sin(th);

          return (
            <div
              key={m.id}
              ref={(el) => { cardRefs.current[i] = el; }}
              className="absolute z-20 pointer-events-none"
              style={{
                left: `${(CX / SVG_W) * 100}%`,
                top:  `${(CY / SVG_H) * 100}%`,
                transform: `translate(-50%, -50%) translate(${(initX - CX).toFixed(2)}px, ${(initY - CY).toFixed(2)}px)`,
                transformOrigin: 'center center',
                willChange: 'transform',
              }}
            >
              <div
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 whitespace-nowrap select-none pointer-events-auto"
                style={{
                  background: 'rgba(12, 18, 14, 0.82)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
                }}
              >
                <div
                  className="grid size-7 shrink-0 place-items-center rounded-lg"
                  style={{
                    background: `${m.iconColor}14`,
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
