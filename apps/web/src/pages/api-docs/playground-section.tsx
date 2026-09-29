import { useState } from 'react';
import { RefreshIcon, SendIcon, SparkleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { DocHeading } from '@/components/docs/doc-heading';

export function PlaygroundSection() {
  const [testModel, setTestModel] = useState('gpt-6-astra');
  const [testPrompt, setTestPrompt] = useState(
    'Проанализируй локальный репозиторий и создай скрипт для запуска тестов',
  );
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const handleRunTest = () => {
    setTestLoading(true);
    setTestResponse('');
    const fullText = `[Ketner AI Engine • ${testModel}]\n\nПодключение к хост-машине успешно установлено.\n\nПроект обнаружен в текущей директории:\n  ✔ Package Manager: npm (workspaces: apps/web, apps/mock-api)\n  ✔ Environment: Node.js >= 20.0, TypeScript 5.8\n  ✔ Test Runner: Vitest / Node test runner\n\nСгенерирован план выполнения задачи:\n1. Запуск статических анализаторов (eslint & tsc --noEmit)\n2. Запуск unit-тестов в изолированных потоках\n3. Готовность к исполнению локальных команд агентом.`;

    let i = 0;
    const interval = setInterval(() => {
      i += 12;
      setTestResponse(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(interval);
        setTestLoading(false);
      }
    }, 25);
  };

  return (
    <section id="playground" className="flex flex-col gap-4 rounded-xl border border-stroke bg-surface p-5 md:p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-stroke pb-3">
        <div className="flex items-center gap-2.5">
          <SparkleIcon className="text-accent text-lg" />
          <DocHeading level={2} id="playground" className="text-base font-semibold text-text">
            Быстрая проверка API (Live Playground)
          </DocHeading>
        </div>
        <span className="text-xs text-muted font-mono">POST /v1/chat/completions</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted block mb-1">Модель для запроса</label>
          <select
            value={testModel}
            onChange={(e) => setTestModel(e.target.value)}
            className="w-full rounded-md border border-stroke bg-canvas px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
          >
            <option value="gpt-6-astra">GPT-6 Astra (Флагман OpenAI)</option>
            <option value="claude-fable-5.5">Claude Fable 5.5 (Код & Архитектура)</option>
            <option value="gemini-3.8-pro">Gemini 3.8 Pro (2M токенов)</option>
            <option value="qwen-2.5-coder">Qwen 2.5 Coder (Быстрая модель)</option>
          </select>
        </div>

        <div className="md:col-span-2 flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted block mb-1">Промпт тестового запроса</label>
            <input
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              className="w-full rounded-md border border-stroke bg-canvas px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={testLoading}
            onClick={handleRunTest}
            className="h-8 shrink-0 flex items-center gap-1.5"
          >
            {testLoading ? (
              <>
                <RefreshIcon className="animate-spin text-xs" />
                <span>Выполняется...</span>
              </>
            ) : (
              <>
                <SendIcon className="text-xs" />
                <span>Отправить</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {testResponse !== null && (
        <div className="mt-2 rounded-lg border border-stroke bg-canvas p-3.5 text-xs font-mono text-accent whitespace-pre-wrap leading-relaxed animate-fade-in">
          {testResponse}
          {testLoading && (
            <span className="inline-block size-2 bg-accent animate-pulse ml-1" />
          )}
        </div>
      )}
    </section>
  );
}
