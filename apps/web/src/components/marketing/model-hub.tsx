/**
 * ModelHub — «оркестр моделей» для панели входа и регистрации.
 *
 * Ketner AI в центре, шесть моделей на орбите. Карточки мягко расходятся от курсора,
 * не наезжая друг на друга, и плавно возвращаются на свои места.
 *
 * Вся сцена считается в логических координатах W×H и масштабируется одним CSS-transform:
 * размеры карточек и орбита всегда пропорциональны. Цвета берутся из токенов — сцена
 * одинаково читается в тёмной и светлой темах. Анимация стоит на паузе, пока блок вне
 * экрана, и не запускается при «уменьшить движение» (тогда карточки просто на местах).
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { ModelMark } from '@/components/ui/model-mark';
import { cn } from '@/lib/cn';
import { modelColor } from '@/lib/model-color';
import { useReducedMotion } from '@/lib/use-reduced-motion';

// ─── Геометрия сцены ──────────────────────────────────────────────────────────

const W = 500;
const H = 440;
const CX = W / 2;
const CY = H / 2;
const ORBIT_R = 185;
/** Масштаб сцены не растёт выше этого значения: на широких экранах она не раздувается. */
const MAX_WIDTH = 550;

const CARD_W = 148;
const CARD_H = 44;
const CORNER_R = 12;

// ─── Физика (шаг фиксирован: поведение не зависит от частоты кадров) ───────────

const STEP_MS = 1000 / 60;
const K_HOME_SPRING = 0.024;
const ANG_DAMPING = 0.91;
const MAX_ANG_VEL = 0.042;
const CURSOR_REPEL_RADIUS = 160;
const CURSOR_ANG_FORCE = 0.034;
const MAX_RADIAL_PUSH = 14;

function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
}

/** Пересечение двух скруглённых карточек: глубина проникновения или 0. */
function penetrationDepth(x1: number, y1: number, x2: number, y2: number): number {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const overlapX = CARD_W - dx;
  const overlapY = CARD_H - dy;
  if (overlapX <= 0 || overlapY <= 0) {
    return 0;
  }

  const flatW = CARD_W - 2 * CORNER_R;
  const flatH = CARD_H - 2 * CORNER_R;
  if (dx > flatW && dy > flatH) {
    const cornerDistance = Math.hypot(dx - flatW, dy - flatH);
    return cornerDistance >= 2 * CORNER_R ? 0 : 2 * CORNER_R - cornerDistance;
  }
  return Math.min(overlapX, overlapY);
}

// ─── Модели ───────────────────────────────────────────────────────────────────

interface HubModel {
  /** Идентификатор для иконки и цвета бренда. */
  id: string;
  name: string;
  tag: string;
}

const MODELS: readonly HubModel[] = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1', tag: 'Sol' },
  { id: 'gemini-3.8-flash', name: 'Gemini', tag: '3.8 Flash' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek', tag: 'V4.1 Flash' },
  { id: 'ketner-pro', name: 'Ketner', tag: 'Pro' },
  { id: 'grok-4.7', name: 'Grok', tag: '4.7' },
  { id: 'claude-opus-5.5', name: 'Claude', tag: 'Opus 5.5' },
];

const N = MODELS.length;
const HOME_ANGLES = MODELS.map((_, index) => wrapAngle(-Math.PI / 2 + (index * 2 * Math.PI) / N));

interface Sim {
  angle: number[];
  velocity: number[];
  radius: number[];
}

function createSim(): Sim {
  return {
    angle: [...HOME_ANGLES],
    velocity: MODELS.map(() => 0),
    radius: MODELS.map(() => ORBIT_R),
  };
}

/** Один шаг симуляции. `cursor` — в логических координатах сцены. */
function stepSim(sim: Sim, cursor: { x: number; y: number } | null, seconds: number): void {
  const { angle, velocity, radius } = sim;
  const cursorAngle = cursor ? Math.atan2(cursor.y - CY, cursor.x - CX) : 0;
  const cursorFromCenter = cursor ? Math.hypot(cursor.x - CX, cursor.y - CY) : 0;
  const cursorOnOrbit = cursor !== null && cursorFromCenter > 40 && cursorFromCenter < 340;

  for (let i = 0; i < N; i += 1) {
    const theta = angle[i];
    let force = wrapAngle(HOME_ANGLES[i] - theta) * K_HOME_SPRING;
    let targetRadius = ORBIT_R;

    if (cursor && cursorOnOrbit) {
      const x = CX + radius[i] * Math.cos(theta);
      const y = CY + radius[i] * Math.sin(theta);
      const distance = Math.hypot(x - cursor.x, y - cursor.y);
      if (distance < CURSOR_REPEL_RADIUS && distance > 0.5) {
        const falloff = 1 - distance / CURSOR_REPEL_RADIUS;
        const intensity = falloff * falloff;
        const sign = wrapAngle(theta - cursorAngle) >= 0 ? 1 : -1;
        force += sign * intensity * CURSOR_ANG_FORCE;
        targetRadius = ORBIT_R + intensity * MAX_RADIAL_PUSH;
      }
    } else {
      // Спокойное «дыхание» орбиты, пока курсора рядом нет.
      force += Math.sin(seconds * 0.65 + (i * 2 * Math.PI) / N) * 0.0014;
    }

    radius[i] += (targetRadius - radius[i]) * 0.12;
    velocity[i] = Math.max(-MAX_ANG_VEL, Math.min(MAX_ANG_VEL, (velocity[i] + force) * ANG_DAMPING));
    angle[i] = wrapAngle(theta + velocity[i]);
  }

  // Несколько проходов, чтобы карточки не налезали друг на друга.
  for (let pass = 0; pass < 5; pass += 1) {
    for (let i = 0; i < N; i += 1) {
      for (let j = i + 1; j < N; j += 1) {
        const depth = penetrationDepth(
          CX + radius[i] * Math.cos(angle[i]),
          CY + radius[i] * Math.sin(angle[i]),
          CX + radius[j] * Math.cos(angle[j]),
          CY + radius[j] * Math.sin(angle[j]),
        );
        if (depth > 0) {
          const direction = wrapAngle(angle[j] - angle[i]) >= 0 ? 1 : -1;
          const correction = (depth / ORBIT_R + 0.005) * 0.5;
          angle[j] = wrapAngle(angle[j] + direction * correction);
          angle[i] = wrapAngle(angle[i] - direction * correction);
          const shared = ((velocity[i] + velocity[j]) / 2) * 0.6;
          velocity[i] = shared;
          velocity[j] = shared;
        }
      }
    }
  }
}

// ─── Компонент ────────────────────────────────────────────────────────────────

export function ModelHub({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>(MODELS.map(() => null));
  const lineRefs = useRef<Array<SVGLineElement | null>>(MODELS.map(() => null));
  const simRef = useRef<Sim>(createSim());
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  // Масштаб сцены следует за шириной контейнера.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) {
      return;
    }
    const measure = (): void => {
      const width = outer.clientWidth;
      if (width > 0) {
        inner.style.transform = `scale(${(width / W).toFixed(4)})`;
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  // Анимация: идёт только пока блок на экране и движение не отключено.
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer || reduced) {
      return;
    }

    const sim = simRef.current;
    let frame = 0;
    let last = 0;
    let carry = 0;

    const render = (): void => {
      for (let i = 0; i < N; i += 1) {
        const x = sim.radius[i] * Math.cos(sim.angle[i]);
        const y = sim.radius[i] * Math.sin(sim.angle[i]);
        const card = cardRefs.current[i];
        if (card) {
          card.style.transform = `translate(-50%, -50%) translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
        }
        const line = lineRefs.current[i];
        if (line) {
          line.setAttribute('x1', (CX + x).toFixed(1));
          line.setAttribute('y1', (CY + y).toFixed(1));
        }
      }
    };

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick);
      carry += Math.min(64, now - last);
      last = now;
      let steps = 0;
      while (carry >= STEP_MS && steps < 4) {
        stepSim(sim, cursorRef.current, now / 1000);
        carry -= STEP_MS;
        steps += 1;
      }
      if (steps === 4) {
        carry = 0;
      }
      if (steps > 0) {
        render();
      }
    };

    const start = (): void => {
      if (frame === 0) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const stop = (): void => {
      cancelAnimationFrame(frame);
      frame = 0;
      cursorRef.current = null;
    };

    const onPointerMove = (event: PointerEvent): void => {
      const rect = outer.getBoundingClientRect();
      if (rect.width === 0) {
        return;
      }
      const scale = rect.width / W;
      cursorRef.current = { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
    };
    const onPointerLeave = (): void => {
      cursorRef.current = null;
    };
    outer.addEventListener('pointermove', onPointerMove);
    outer.addEventListener('pointerleave', onPointerLeave);

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'undefined') {
      start();
    } else {
      observer = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()));
      observer.observe(outer);
    }

    return () => {
      observer?.disconnect();
      stop();
      outer.removeEventListener('pointermove', onPointerMove);
      outer.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [reduced]);

  return (
    <div className={cn('flex w-full items-center justify-center', className)}>
      <div
        ref={outerRef}
        className="relative w-full overflow-visible"
        style={{ maxWidth: MAX_WIDTH, aspectRatio: `${W} / ${H}` }}
      >
        <div
          ref={innerRef}
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: W, height: H }}
        >
          <svg
            className="pointer-events-none absolute inset-0 size-full overflow-visible text-stroke-strong"
            viewBox={`0 0 ${W} ${H}`}
            fill="none"
            aria-hidden="true"
          >
            <circle cx={CX} cy={CY} r={92} className="fill-accent/10" />
            <circle
              cx={CX}
              cy={CY}
              r={ORBIT_R}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 7"
            />
            <circle
              cx={CX}
              cy={CY}
              r={ORBIT_R + 28}
              stroke="currentColor"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="1 9"
            />
            {MODELS.map((model, i) => (
              <line
                key={model.id}
                ref={(element) => {
                  lineRefs.current[i] = element;
                }}
                className="flow-line"
                x1={CX + ORBIT_R * Math.cos(HOME_ANGLES[i])}
                y1={CY + ORBIT_R * Math.sin(HOME_ANGLES[i])}
                x2={CX}
                y2={CY}
                stroke="currentColor"
                strokeOpacity={0.85}
                strokeWidth={1}
              />
            ))}
          </svg>

          {/* Центр: Ketner AI */}
          <div
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: CX, top: CY }}
          >
            <div className="rounded-full bg-brand-gradient p-px shadow-glow">
              <div className="relative grid size-[88px] place-items-center rounded-full bg-surface-2">
                <span
                  aria-hidden="true"
                  className="absolute inset-1.5 rounded-full border border-dashed border-accent/30"
                />
                <img src="/logo-mark-160.png" alt="" className="size-9 object-contain" />
              </div>
            </div>
          </div>

          {/* Модели на орбите */}
          {MODELS.map((model, i) => (
            <div
              key={model.id}
              ref={(element) => {
                cardRefs.current[i] = element;
              }}
              className="absolute z-20 will-change-transform"
              style={{
                left: CX,
                top: CY,
                width: CARD_W,
                height: CARD_H,
                transform: `translate(-50%, -50%) translate(${(ORBIT_R * Math.cos(HOME_ANGLES[i])).toFixed(2)}px, ${(ORBIT_R * Math.sin(HOME_ANGLES[i])).toFixed(2)}px)`,
              }}
            >
              <div className="flex size-full items-center gap-2.5 rounded-xl border border-stroke-strong bg-surface-2 px-2.5 shadow-md">
                <ModelMark modelId={model.id} size="sm" />
                <div className="min-w-0 text-left leading-tight">
                  <div className="truncate text-xs font-semibold text-text">{model.name}</div>
                  <div
                    className="truncate text-[11px] font-medium"
                    style={{ color: modelColor(model.id) }}
                  >
                    {model.tag}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
