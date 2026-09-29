import { MethodBadge } from '@/components/docs/method-badge';
import { ParamTable, type ParamDef } from '@/components/docs/param-table';
import { CodeTabs } from '@/components/docs/code-tabs';
import { DocHeading } from '@/components/docs/doc-heading';
import { getCompletionsSnippets } from './snippets';

const COMPLETION_PARAMS: ParamDef[] = [
  {
    name: 'model',
    type: 'string',
    required: true,
    description: 'Идентификатор модели (например, "gpt-6-astra", "claude-fable-5.5", "gemini-3.8-pro").',
  },
  {
    name: 'messages',
    type: 'array',
    required: true,
    description: 'Список сообщений в диалоге с полями role ("system" | "user" | "assistant") и content.',
  },
  {
    name: 'stream',
    type: 'boolean',
    default: 'false',
    description: 'Если true — ответ передаётся потоком по протоколу Server-Sent Events (SSE).',
  },
  {
    name: 'temperature',
    type: 'number',
    default: '0.7',
    description: 'Степень вариативности ответов от 0 до 2. Для задач программирования рекомендуется 0.2.',
  },
  {
    name: 'max_tokens',
    type: 'integer',
    description: 'Максимальное количество токенов в сгенерированном ответе.',
  },
];

export function EndpointCompletions({ apiKey }: { apiKey: string }) {
  const snippets = getCompletionsSnippets(apiKey);

  return (
    <section id="endpoint-completions" className="flex flex-col gap-4 rounded-xl border border-stroke bg-surface p-5 md:p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stroke pb-4">
        <div className="flex items-center gap-3">
          <MethodBadge method="POST" />
          <DocHeading level={2} id="endpoint-completions" className="text-base md:text-lg font-mono font-semibold text-text">
            /v1/chat/completions
          </DocHeading>
        </div>
        <span className="text-xs text-muted">OpenAI Chat Completion API</span>
      </div>

      <p className="text-xs text-muted leading-relaxed">
        Основной эндпоинт генерации ответов. Поддерживает синхронный режим и потоковый SSE-вывод
        токенов для мгновенного отклика интерфейса и AI-агентов.
      </p>

      <div className="mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
          Параметры тела запроса (JSON body)
        </h4>
        <ParamTable params={COMPLETION_PARAMS} />
      </div>

      <div className="mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
          Примеры вызова и ответ
        </h4>
        <CodeTabs tabs={snippets} />
      </div>
    </section>
  );
}
