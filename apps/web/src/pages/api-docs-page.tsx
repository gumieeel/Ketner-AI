import { useEffect, useState } from 'react';
import {
  CpuIcon,
  SparkleIcon,
  TerminalIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/docs/callout';
import { CodeTabs } from '@/components/docs/code-tabs';
import { CopyButton } from '@/components/ui/copy-button';
import { DocHeading } from '@/components/docs/doc-heading';
import { DocsLayout } from '@/components/docs/docs-layout';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';
import { KeysSection, type ApiKeyItem } from './api-docs/keys-section';
import { EndpointCompletions } from './api-docs/endpoint-completions';
import { EndpointConversations } from './api-docs/endpoint-conversations';
import { SecuritySection } from './api-docs/security-section';
import { PlaygroundSection } from './api-docs/playground-section';
import {
  CLI_RUN_SNIPPET,
  getCliAuthSnippets,
  getCliInstallSnippets,
  getContinueConfigSnippet,
  getMcpConfigSnippet,
  getSdkSnippets,
} from './api-docs/snippets';

const DEFAULT_KEYS: ApiKeyItem[] = [
  {
    id: 'key-default-1',
    name: 'MacBook Pro CLI Agent',
    key: 'ketner_sk_live_9f83a21b9c744e82',
    createdAt: '2026-09-20',
    permissions: 'all-models, file-access, shell-exec',
  },
  {
    id: 'key-default-2',
    name: 'Cursor IDE Assistant',
    key: 'ketner_sk_live_1d45c88e7b321a90',
    createdAt: '2026-09-22',
    permissions: 'all-models, read-only',
  },
];

type OsType = 'windows' | 'macos' | 'linux';

const API_DOCS_NAV = [
  { id: 'overview', label: 'Обзор' },
  { id: 'keys', label: 'API-ключи' },
  { id: 'base-url', label: 'Base URL' },
  { id: 'cli', label: 'Ketner CLI' },
  { id: 'ide', label: 'Cursor & VS Code' },
  { id: 'mcp', label: 'Протокол MCP' },
  { id: 'sdk', label: 'SDK & Примеры' },
  { id: 'endpoint-completions', label: 'Chat Completions' },
  { id: 'endpoint-conversations', label: 'Conversations' },
  { id: 'security', label: 'Безопасность' },
  { id: 'playground', label: 'Playground' },
];

const API_DOCS_TOC = [
  { id: 'overview', label: 'Обзор платформы' },
  { id: 'keys', label: 'Ключи доступа' },
  { id: 'base-url', label: 'Базовые параметры' },
  { id: 'cli', label: 'Ketner CLI на машине' },
  { id: 'ide', label: 'Интеграция с IDE' },
  { id: 'mcp', label: 'MCP Протокол' },
  { id: 'sdk', label: 'Python & Node SDK' },
  { id: 'endpoint-completions', label: 'POST /chat/completions' },
  { id: 'endpoint-conversations', label: 'GET /conversations' },
  { id: 'security', label: 'Безопасность на машине' },
  { id: 'playground', label: 'Live Playground' },
];

export function ApiDocsPage() {
  const { t } = useTranslation();
  const [os, setOs] = useState<OsType>('windows');

  const [keys, setKeys] = useState<ApiKeyItem[]>(() => {
    try {
      const saved = localStorage.getItem('ketner_api_keys');
      if (saved) return JSON.parse(saved) as ApiKeyItem[];
    } catch {
      // ignore
    }
    return DEFAULT_KEYS;
  });

  const activeApiKey = keys[0]?.key || 'ketner_sk_live_your_api_key_here';

  useEffect(() => {
    try {
      localStorage.setItem('ketner_api_keys', JSON.stringify(keys));
    } catch {
      // ignore
    }
  }, [keys]);

  const handleAddKey = (name: string) => {
    const randomHex = Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
    const newKey: ApiKeyItem = {
      id: `key-${Date.now()}`,
      name,
      key: `ketner_sk_live_${randomHex}`,
      createdAt: new Date().toISOString().split('T')[0],
      permissions: 'all-models, file-access, shell-exec',
    };
    setKeys([newKey, ...keys]);
  };

  const handleRevokeKey = (id: string) => {
    setKeys(keys.filter((k) => k.id !== id));
  };

  const cliInstallSnippets = getCliInstallSnippets();
  const cliAuthSnippets = getCliAuthSnippets(activeApiKey);
  const sdkSnippets = getSdkSnippets(activeApiKey);

  return (
    <div className="w-full bg-canvas text-text min-h-screen">
      <DocsLayout nav={API_DOCS_NAV} toc={API_DOCS_TOC}>
        <div className="flex flex-col gap-10">
          {/* Заголовок страницы */}
          <section id="overview" className="flex flex-col gap-4 border-b border-stroke pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">OpenAI v1 Compatible</Badge>
              <Badge tone="neutral">MCP Protocol</Badge>
              <Badge tone="outline">CLI Daemon v1.4</Badge>
            </div>

            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-text flex items-center gap-3">
              <TerminalIcon className="text-accent text-3xl shrink-0" />
              {t('apiDocs.title')}
            </h1>
            <p className="text-sm md:text-base text-muted max-w-3xl leading-relaxed">
              {t('apiDocs.subtitle')}
            </p>
          </section>

          {/* БЛОК 1: Секретные API-ключи */}
          <KeysSection
            keys={keys}
            onAddKey={handleAddKey}
            onRevokeKey={handleRevokeKey}
          />

          {/* БЛОК 2: Базовые параметры API */}
          <section id="base-url" className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-stroke bg-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted font-mono">
                Base URL (OpenAI V1)
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2 font-mono text-xs border border-stroke">
                <span className="truncate text-accent font-medium">https://api.ketner.ai/v1</span>
                <CopyButton value="https://api.ketner.ai/v1" label="Копировать Base URL" size="sm" />
              </div>
              <p className="mt-2 text-[11px] text-muted leading-relaxed">
                Совместим с любыми библиотеками и IDE с поддержкой OpenAI spec.
              </p>
            </div>

            <div className="rounded-xl border border-stroke bg-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted font-mono">
                Поддерживаемые модели
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded bg-canvas border border-stroke px-2 py-0.5 font-mono text-[11px] text-text">
                  gpt-6-astra
                </span>
                <span className="rounded bg-canvas border border-stroke px-2 py-0.5 font-mono text-[11px] text-text">
                  claude-fable-5.5
                </span>
                <span className="rounded bg-canvas border border-stroke px-2 py-0.5 font-mono text-[11px] text-text">
                  gemini-3.8-pro
                </span>
                <span className="rounded bg-canvas border border-stroke px-2 py-0.5 font-mono text-[11px] text-text">
                  qwen-2.5-coder
                </span>
              </div>
              <p className="mt-2 text-[11px] text-muted leading-relaxed">
                Указывайте имя модели в теле запроса или конфигурации IDE.
              </p>
            </div>

            <div className="rounded-xl border border-stroke bg-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted font-mono">
                Протокол агента
              </p>
              <p className="mt-2 text-sm font-semibold text-text">SSE Streaming & Tool Calling</p>
              <p className="mt-1 text-[11px] text-muted leading-relaxed">
                Потоковый вывод токенов и поддержка вызова функций на хост-машине.
              </p>
            </div>
          </section>

          {/* БЛОК 3: Ketner CLI */}
          <section id="cli" className="flex flex-col gap-6 rounded-xl border border-stroke bg-surface p-5 md:p-7 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stroke pb-4">
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-lg bg-surface-2 border border-stroke text-accent">
                  <TerminalIcon className="text-lg" />
                </div>
                <div>
                  <DocHeading level={2} id="cli" className="text-base md:text-lg font-semibold text-text">
                    Ketner CLI: Запуск автономного агента в терминале
                  </DocHeading>
                  <p className="text-xs text-muted mt-0.5">
                    Прямой доступ к терминалу, git и кодовой базе проекта
                  </p>
                </div>
              </div>

              {/* Выбор ОС */}
              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-canvas border border-stroke self-start md:self-auto text-xs">
                <span className="text-muted text-[11px] px-2">ОС:</span>
                {(['windows', 'macos', 'linux'] as const).map((osKey) => (
                  <button
                    key={osKey}
                    type="button"
                    onClick={() => setOs(osKey)}
                    className={cn(
                      'rounded-md px-2.5 py-1 capitalize transition-colors font-medium text-xs',
                      os === osKey
                        ? 'bg-surface text-accent font-semibold shadow-sm border border-stroke'
                        : 'text-muted hover:text-text',
                    )}
                  >
                    {osKey === 'windows' ? 'Windows' : osKey === 'macos' ? 'macOS' : 'Linux'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-6">
              {/* Шаг 1: Установка */}
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-surface-2 border border-stroke text-accent text-xs font-mono">
                    1
                  </span>
                  Установка пакета CLI
                </h4>
                <p className="text-xs text-muted">
                  Выберите команду для установки глобального пакета агента:
                </p>
                <CodeTabs
                  tabs={[
                    {
                      id: 'powershell',
                      label: 'PowerShell (Windows)',
                      language: 'powershell',
                      code: cliInstallSnippets.powershell,
                    },
                    {
                      id: 'macos',
                      label: 'Terminal (macOS)',
                      language: 'bash',
                      code: cliInstallSnippets.macos,
                    },
                    {
                      id: 'linux',
                      label: 'Bash (Linux)',
                      language: 'bash',
                      code: cliInstallSnippets.linux,
                    },
                  ]}
                  defaultTabId={os === 'windows' ? 'powershell' : os}
                />
              </div>

              {/* Шаг 2: Авторизация */}
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-surface-2 border border-stroke text-accent text-xs font-mono">
                    2
                  </span>
                  Авторизация агента через API-ключ
                </h4>
                <p className="text-xs text-muted">
                  Сохраните ключ в переменных окружения или выполните быстрый логин:
                </p>
                <CodeTabs
                  tabs={[
                    {
                      id: 'powershell',
                      label: 'PowerShell',
                      language: 'powershell',
                      code: cliAuthSnippets.powershell,
                    },
                    {
                      id: 'bash',
                      label: 'Zsh / Bash',
                      language: 'bash',
                      code: cliAuthSnippets.bash,
                    },
                  ]}
                  defaultTabId={os === 'windows' ? 'powershell' : 'bash'}
                />
              </div>

              {/* Шаг 3: Запуск */}
              <div className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                  <span className="grid size-5 place-items-center rounded-full bg-surface-2 border border-stroke text-accent text-xs font-mono">
                    3
                  </span>
                  Запуск агента в папке репозитория
                </h4>
                <CodeTabs
                  tabs={[
                    {
                      id: 'run',
                      label: 'Terminal команды',
                      language: 'bash',
                      code: CLI_RUN_SNIPPET,
                    },
                  ]}
                />
              </div>
            </div>
          </section>

          {/* БЛОК 4: IDE интеграция */}
          <section id="ide" className="flex flex-col gap-6 rounded-xl border border-stroke bg-surface p-5 md:p-7 shadow-sm">
            <div className="flex items-center gap-3 border-b border-stroke pb-4">
              <div className="grid size-9 place-items-center rounded-lg bg-surface-2 border border-stroke text-accent">
                <CpuIcon className="text-lg" />
              </div>
              <div>
                <DocHeading level={2} id="ide" className="text-base md:text-lg font-semibold text-text">
                  Интеграция с Cursor, VS Code и Windsurf
                </DocHeading>
                <p className="text-xs text-muted mt-0.5">
                  Прямое подключение моделей Ketner AI через OpenAI-совместимый протокол
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-stroke bg-canvas p-4.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm text-text">Настройка в Cursor AI</h4>
                <Badge tone="brand">Cursor</Badge>
              </div>
              <ol className="list-decimal list-inside text-xs text-muted flex flex-col gap-2 leading-relaxed">
                <li>
                  Откройте настройки: <code className="text-text font-mono">Cursor Settings</code> →{' '}
                  <code className="text-text font-mono">Models</code>.
                </li>
                <li>
                  Включите тумблер <strong>OpenAI API Key</strong> или нажмите{' '}
                  <strong>Add Model</strong>.
                </li>
                <li>
                  В поле <strong>Override OpenAI Base URL</strong> укажите:{' '}
                  <code className="text-accent font-mono font-medium">https://api.ketner.ai/v1</code>
                </li>
                <li>
                  В поле <strong>API Key</strong> вставьте ваш ключ:{' '}
                  <code className="text-text font-mono">{activeApiKey}</code>
                </li>
                <li>
                  Добавьте идентификаторы моделей:{' '}
                  <code className="text-text font-mono">gpt-6-astra</code>,{' '}
                  <code className="text-text font-mono">claude-fable-5.5</code>,{' '}
                  <code className="text-text font-mono">gemini-3.8-pro</code>.
                </li>
              </ol>
            </div>

            <div className="rounded-lg border border-stroke bg-canvas p-4.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm text-text">
                  Настройка в VS Code (Cline, Roo Code или Continue.dev)
                </h4>
                <Badge tone="neutral">VS Code</Badge>
              </div>
              <p className="text-xs text-muted">
                Вставьте фрагмент в конфигурационный файл{' '}
                <code className="text-text font-mono">~/.continue/config.json</code>:
              </p>
              <CodeTabs
                tabs={[
                  {
                    id: 'config',
                    label: '~/.continue/config.json',
                    language: 'json',
                    code: getContinueConfigSnippet(activeApiKey),
                  },
                ]}
              />
            </div>
          </section>

          {/* БЛОК 5: MCP Протокол */}
          <section id="mcp" className="flex flex-col gap-6 rounded-xl border border-stroke bg-surface p-5 md:p-7 shadow-sm">
            <div className="flex items-center gap-3 border-b border-stroke pb-4">
              <div className="grid size-9 place-items-center rounded-lg bg-surface-2 border border-stroke text-accent">
                <SparkleIcon className="text-lg" />
              </div>
              <div>
                <DocHeading level={2} id="mcp" className="text-base md:text-lg font-semibold text-text">
                  MCP (Model Context Protocol): Подключение системных инструментов
                </DocHeading>
                <p className="text-xs text-muted mt-0.5">
                  Стандарт безопасного доступа модели к файловой системе, SQLite и сервисам
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-stroke bg-canvas p-3.5 text-xs text-muted">
              <span className="font-semibold text-text">Пути к файлу claude_desktop_config.json:</span>
              <ul className="mt-1.5 flex flex-col gap-1 font-mono text-[11px]">
                <li>
                  <strong className="text-text">Windows:</strong>{' '}
                  <span className="text-accent">%APPDATA%\Claude\claude_desktop_config.json</span>
                </li>
                <li>
                  <strong className="text-text">macOS:</strong>{' '}
                  <span className="text-accent">
                    ~/Library/Application Support/Claude/claude_desktop_config.json
                  </span>
                </li>
                <li>
                  <strong className="text-text">Linux:</strong>{' '}
                  <span className="text-accent">~/.config/claude/claude_desktop_config.json</span>
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text">
                Готовый файл claude_desktop_config.json
              </h4>
              <CodeTabs
                tabs={[
                  {
                    id: 'mcp-config',
                    label: 'claude_desktop_config.json',
                    language: 'json',
                    code: getMcpConfigSnippet(activeApiKey, os),
                  },
                ]}
              />
            </div>

            <Callout tone="info" title="Как проверить работу MCP">
              После перезапуска Claude Desktop или Cursor внизу в строке ввода появится иконка
              инструментов (Tools) со списком подключенных возможностей: чтение файлов, выполнение
              SQL-запросов и запуск агента Ketner.
            </Callout>
          </section>

          {/* БЛОК 6: SDK & Примеры */}
          <section id="sdk" className="flex flex-col gap-6 rounded-xl border border-stroke bg-surface p-5 md:p-7 shadow-sm">
            <div className="flex items-center gap-3 border-b border-stroke pb-4">
              <div className="grid size-9 place-items-center rounded-lg bg-surface-2 border border-stroke text-accent">
                <TerminalIcon className="text-lg" />
              </div>
              <div>
                <DocHeading level={2} id="sdk" className="text-base md:text-lg font-semibold text-text">
                  Программный доступ: Python, Node.js и cURL
                </DocHeading>
                <p className="text-xs text-muted mt-0.5">
                  Используйте стандартные библиотеки OpenAI без установки проприетарных SDK
                </p>
              </div>
            </div>

            <CodeTabs tabs={sdkSnippets} />
          </section>

          {/* БЛОК 7: Эндпоинты */}
          <EndpointCompletions apiKey={activeApiKey} />
          <EndpointConversations apiKey={activeApiKey} />

          {/* БЛОК 8: Безопасность */}
          <SecuritySection />

          {/* БЛОК 9: Playground */}
          <PlaygroundSection />

          {/* Подвал страницы со ссылками */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-stroke pt-6 pb-4 text-xs text-muted">
            <span>Ketner AI Developer Hub · OpenAI-Compatible Platform</span>
            <div className="flex items-center gap-4">
              <a href="/chat" className="text-muted hover:text-text transition-colors">В чат</a>
              <span>•</span>
              <a href="/pricing" className="text-muted hover:text-text transition-colors">Тарифы</a>
              <span>•</span>
              <a href="/docs" className="text-muted hover:text-text transition-colors">Документация</a>
            </div>
          </div>
        </div>
      </DocsLayout>
    </div>
  );
}
