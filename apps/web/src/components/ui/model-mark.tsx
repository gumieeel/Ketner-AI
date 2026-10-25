import { SparkleIcon } from '@/components/icons';
import { ModelBrandIcon, getModelBrand } from '@/components/icons/brands';
import { cn } from '@/lib/cn';
import { modelColor } from '@/lib/model-color';

export type ModelMarkSize = 'sm' | 'md' | 'lg';

const boxClasses: Record<ModelMarkSize, string> = {
  sm: 'size-6 rounded-md',
  md: 'size-8 rounded-[10px]',
  lg: 'size-10 rounded-xl',
};

const iconClasses: Record<ModelMarkSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
};

export interface ModelMarkProps {
  modelId: string;
  size?: ModelMarkSize;
  className?: string;
}

/**
 * Плитка модели: иконка бренда на подложке его цвета.
 * Декоративная — название модели всегда выводится рядом текстом.
 */
export function ModelMark({ modelId, size = 'md', className }: ModelMarkProps) {
  const color = modelColor(modelId);
  const isAuto = modelId === 'auto';
  const isKetner = !isAuto && getModelBrand(modelId) === 'ketner';

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center', boxClasses[size], className)}
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {isAuto ? (
        <SparkleIcon className={iconClasses[size]} />
      ) : isKetner ? (
        <img src="/logo-mark-160.png" alt="" className={cn('object-contain', iconClasses[size])} />
      ) : (
        <ModelBrandIcon modelId={modelId} className={iconClasses[size]} />
      )}
    </span>
  );
}
