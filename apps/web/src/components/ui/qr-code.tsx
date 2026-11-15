import React, { useMemo } from 'react';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { qrPath } from '@/lib/qr';

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  badge?: React.ReactNode;
}

export function QrCode({ value, size = 192, className = '', badge }: QrCodeProps) {
  const { t } = useTranslation();
  const { path, count } = useMemo(() => qrPath(value), [value]);

  return (
    <div
      className={cn(
        'relative inline-flex items-center justify-center rounded-lg border border-stroke bg-white p-3 shadow-popover',
        className,
      )}
      style={{ width: size + 24, height: size + 24 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${count} ${count}`}
        shapeRendering="crispEdges"
        className="block"
        role="img"
        aria-label={t('common.qrCode', { value })}
      >
        <rect width={count} height={count} fill="#ffffff" />
        <path d={path} fill="#09090b" />
      </svg>

      {badge ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-md border border-stroke bg-white p-1.5 shadow-sm">{badge}</div>
        </div>
      ) : null}
    </div>
  );
}
