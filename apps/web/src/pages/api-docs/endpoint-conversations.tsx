import { MethodBadge } from '@/components/docs/method-badge';
import { ParamTable, type ParamDef } from '@/components/docs/param-table';
import { CodeTabs } from '@/components/docs/code-tabs';
import { DocHeading } from '@/components/docs/doc-heading';
import { getConversationsSnippets } from './snippets';

const CONVERSATION_PARAMS: ParamDef[] = [
  {
    name: 'limit',
    type: 'integer',
    default: '20',
    description: 'Количество диалогов на страницу (максимум 100).',
  },
  {
    name: 'before',
    type: 'string',
    description: 'Курсор пагинации для получения предыдущей страницы.',
  },
  {
    name: 'after',
    type: 'string',
    description: 'Курсор пагинации для получения следующей страницы.',
  },
];

export function EndpointConversations({ apiKey }: { apiKey: string }) {
  const snippets = getConversationsSnippets(apiKey);

  return (
    <section id="endpoint-conversations" className="flex flex-col gap-4 rounded-xl border border-stroke bg-surface p-5 md:p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stroke pb-4">
        <div className="flex items-center gap-3">
          <MethodBadge method="GET" />
          <DocHeading level={2} id="endpoint-conversations" className="text-base md:text-lg font-mono font-semibold text-text">
            /v1/conversations
          </DocHeading>
        </div>
        <span className="text-xs text-muted">Sessions & History API</span>
      </div>

      <p className="text-xs text-muted leading-relaxed">
        Возвращает список сохранённых сессий диалогов и контекста агента для текущего аккаунта или API-ключа.
      </p>

      <div className="mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
          Параметры строки запроса (Query params)
        </h4>
        <ParamTable params={CONVERSATION_PARAMS} />
      </div>

      <div className="mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
          Пример запроса и ответа
        </h4>
        <CodeTabs tabs={snippets} />
      </div>
    </section>
  );
}
