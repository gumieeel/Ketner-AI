import { Badge } from '@/components/ui/badge';
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
  if (params.length === 0) return null;

  return (
    <div className={cn('my-4 overflow-x-auto rounded-lg border border-stroke bg-surface', className)}>
      <table className="w-full text-left text-xs">
        <thead className="border-b border-stroke bg-surface-2 text-[11px] font-mono uppercase tracking-[0.06em] text-subtle">
          <tr>
            <th className="px-4 py-2.5">Параметр</th>
            <th className="px-4 py-2.5">Тип</th>
            <th className="px-4 py-2.5">Описание</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stroke">
          {params.map((param) => (
            <tr key={param.name} className="hover:bg-surface-2/60 transition-colors">
              <td className="px-4 py-3 align-top">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono font-medium text-text">{param.name}</span>
                  {param.required ? (
                    <Badge tone="danger" className="text-[10px] py-0 px-1">
                      обязательный
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 align-top font-mono text-muted">{param.type}</td>
              <td className="px-4 py-3 align-top text-text/90 leading-relaxed">
                <p>{param.description}</p>
                {param.defaultVal || param.default ? (
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    По умолчанию: <code className="text-text">{param.defaultVal || param.default}</code>
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
