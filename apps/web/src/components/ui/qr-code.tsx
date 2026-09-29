import React, { useMemo } from 'react';
import { cn } from '@/lib/cn';

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  badge?: React.ReactNode;
}

/**
 * Детерминированный генератор QR-матрицы 29x29 (QR Version 3).
 * Включает точные угловые маркеры (Finder Patterns 7x7) и тайминги,
 * а также детерминированное псевдослучайное заполнение данными по тексту.
 */
function generateQrMatrix(text: string): boolean[][] {
  const size = 29;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isReserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // Finder pattern (7x7)
  const drawFinder = (startX: number, startY: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const isBorder = y === 0 || y === 6 || x === 0 || x === 6;
        const isCenter = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        matrix[startY + y][startX + x] = isBorder || isCenter;
        isReserved[startY + y][startX + x] = true;
      }
    }
    // Separator border (1 cell around)
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const py = startY + y;
        const px = startX + x;
        if (py >= 0 && py < size && px >= 0 && px < size) {
          isReserved[py][px] = true;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    isReserved[6][i] = true;
    matrix[i][6] = i % 2 === 0;
    isReserved[i][6] = true;
  }

  // Alignment pattern (5x5) at (20, 20)
  const ax = 20;
  const ay = 20;
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const isAlignBorder = Math.abs(x) === 2 || Math.abs(y) === 2;
      const isAlignCenter = x === 0 && y === 0;
      matrix[ay + y][ax + x] = isAlignBorder || isAlignCenter;
      isReserved[ay + y][ax + x] = true;
    }
  }

  // Seeded hash from string
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const nextRand = () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  };

  // Populate data modules
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isReserved[y][x]) {
        // Reserved center spot for badge if desired
        if (Math.abs(x - 14) <= 2 && Math.abs(y - 14) <= 2) {
          continue;
        }
        matrix[y][x] = nextRand() > 0.45;
      }
    }
  }

  return matrix;
}

export function QrCode({ value, size = 192, className = '', badge }: QrCodeProps) {
  const matrix = useMemo(() => generateQrMatrix(value), [value]);
  const matrixSize = matrix.length;
  const cellSize = size / matrixSize;

  return (
    <div
      className={cn(
        'relative inline-flex items-center justify-center rounded-lg bg-white p-3 shadow-popover border border-stroke',
        className,
      )}
      style={{ width: size + 24, height: size + 24 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shape-rendering-crispEdges block"
        role="img"
        aria-label={`QR код: ${value}`}
      >
        <rect width={size} height={size} fill="#ffffff" />
        {matrix.map((row, y) =>
          row.map((cell, x) => {
            if (!cell) return null;
            return (
              <rect
                key={`${x}-${y}`}
                x={x * cellSize}
                y={y * cellSize}
                width={cellSize + 0.3}
                height={cellSize + 0.3}
                fill="#09090b"
                rx={cellSize * 0.15}
              />
            );
          }),
        )}
      </svg>

      {badge ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-md bg-white p-1.5 border border-stroke shadow-sm">
            {badge}
          </div>
        </div>
      ) : null}
    </div>
  );
}
