import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Дуга первого экрана: две тонкие линии и светящееся ядро справа от заголовка.
 * Рисуется один раз за ~2 с, потом мягко «дышит». Декоративная, поэтому скрыта от
 * скринридеров. Координаты заданы в системе 1672×941 и привязаны к правому краю,
 * чтобы на узких экранах дуга уходила за край, а не сжималась.
 */
export function HeroArc({ className }: { className?: string }) {
  // Дуга встречается на странице несколько раз: у каждой свои id градиентов и фильтра
  const uid = useId().replace(/:/g, '');
  const coreId = `arc-core-${uid}`;
  const faintId = `arc-faint-${uid}`;
  const blurId = `arc-blur-${uid}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1672 941"
      preserveAspectRatio="xMaxYMid slice"
      className={cn('pointer-events-none absolute inset-0 size-full', className)}
    >
      <defs>
        <linearGradient
          id={coreId}
          gradientUnits="userSpaceOnUse"
          x1="1350"
          y1="215"
          x2="1080"
          y2="900"
        >
          <stop offset="0" style={{ stopColor: 'var(--arc-core)', stopOpacity: 0 }} />
          <stop offset="0.14" style={{ stopColor: 'var(--arc-core)', stopOpacity: 0.9 }} />
          <stop offset="0.5" style={{ stopColor: 'var(--arc-core)', stopOpacity: 0.65 }} />
          <stop offset="1" style={{ stopColor: 'var(--arc-core)', stopOpacity: 0 }} />
        </linearGradient>
        <linearGradient
          id={faintId}
          gradientUnits="userSpaceOnUse"
          x1="740"
          y1="810"
          x2="1150"
          y2="518"
        >
          <stop offset="0" style={{ stopColor: 'var(--arc-faint)', stopOpacity: 0 }} />
          <stop offset="0.5" style={{ stopColor: 'var(--arc-faint)', stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: 'var(--arc-faint)', stopOpacity: 0.4 }} />
        </linearGradient>
        <filter id={blurId} filterUnits="userSpaceOnUse" x="900" y="100" width="640" height="841">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>

      <g className="arc-breathe">
        <path
          className="arc-line arc-faint arc-draw"
          stroke={`url(#${faintId})`}
          pathLength={1}
          d="M 740 810 C 840 670, 990 560, 1150 518"
        />
        <path
          className="arc-line arc-glow arc-draw"
          stroke={`url(#${coreId})`}
          pathLength={1}
          filter={`url(#${blurId})`}
          d="M 1080 941 C 1076 740, 1140 430, 1350 215"
        />
        <path
          className="arc-line arc-core arc-draw"
          stroke={`url(#${coreId})`}
          pathLength={1}
          d="M 1080 941 C 1076 740, 1140 430, 1350 215"
        />
      </g>
    </svg>
  );
}
