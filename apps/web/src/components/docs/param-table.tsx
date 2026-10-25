import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

export interface DocParam {
  name: string;
  type: string;
  required?: boolean;
  defaultVal?: string;
  default?: string;
  description: string;
}

export type ParamDef = DocParam;

export interface ParamTableProps {
  params: DocParam[];
  className?: string;
}

export function ParamTable({ params, className }: ParamTableProps) {
  const { t } = useTranslation();
  if (params.length === 0) return null;

  return (
    <div className={cn('my-4 overflow-x-auto rounded-xl border border-stroke bg-surface shadow-xs', className)}>
      <table className="w-full min-w-[480px] text-left text-[13px]">
        <thead className="border-b border-stroke bg-surface-2/80 text-xs font-semibold text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">{t('docs.paramName')}</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">{t('docs.paramType')}</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">{t('docs.paramDescription')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stroke">
          {params.map((param) => (
            <tr key={param.name} className="transition-colors hover:bg-surface-2/60">
              <td className="px-4 py-3 align-top">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[13px] font-medium text-text">{param.name}</span>
                  {param.required ? (
                    <Badge tone="danger" className="px-1.5 py-0 text-[11px]">
                      {t('docs.required')}
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 align-top font-mono text-xs text-muted">{param.type}</td>
              <td className="px-4 py-3 align-top leading-relaxed text-text/90">
                <p>{param.description}</p>
                {param.defaultVal || param.default ? (
                  <p className="mt-1 text-xs text-muted">
                    {t('docs.defaultValue')}{' '}
                    <code className="font-mono text-text">{param.defaultVal || param.default}</code>
                  </p>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
