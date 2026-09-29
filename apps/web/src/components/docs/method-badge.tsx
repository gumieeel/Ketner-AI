import { Badge } from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const methodTones: Record<HttpMethod, BadgeTone> = {
  GET: 'info',
  POST: 'success',
  DELETE: 'danger',
  PUT: 'warning',
  PATCH: 'warning',
};

export function MethodBadge({ method }: { method: HttpMethod }) {
  const tone = methodTones[method] ?? 'neutral';

  return (
    <Badge tone={tone} className="px-2 py-0.5 font-mono text-[11px] font-semibold">
      {method}
    </Badge>
  );
}
