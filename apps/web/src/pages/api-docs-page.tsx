import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  CpuIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  RefreshIcon,
  SendIcon,
  SparkleIcon,
  TerminalIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { useTranslation } from '@/i18n';

interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  permissions: string;
}

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
type TabType = 'cli' | 'ide' | 'mcp' | 'sdk' | 'security';

function CodeSnippet({
  code,
  language = 'bash',
  title,
}: {
  code: string;
  language?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await copyText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-[12px] border border-stroke/30 bg-[#141414] text-[#ececec] overflow-hidden shadow-md">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-1.5 bg-[#1b1b1b] text-xs">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-red-500/80 inline-block" />
            <span className="size-2.5 rounded-full bg-yellow-500/80 inline-block" />
            <span className="size-2.5 rounded-full bg-green-500/80 inline-block" />
          </span>
          <span className="font-mono text-white/60 text-[11px] font-medium">
            {title || language}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-[6px] bg-white/10 hover:bg-white/20 px-2 py-0.5 text-[11px] text-white/90 transition-colors"
        >
          {copied ? (
            <>
              <CheckIcon className="text-emerald-400 text-xs" />
              <span className="text-emerald-400">Скопировано</span>
            </>
          ) : (
            <>
              <CopyIcon className="text-xs" />
              <span>Копировать</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 text-xs font-mono leading-relaxed overflow-x-auto selection:bg-accent/40 selection:text-white">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function ApiDocsPage() {
  const { t } = useTranslation();
  const [os, setOs] = useState<OsType>('windows');
  const [activeTab, setActiveTab] = useState<TabType>('cli');

  // Управление API-ключами
  const [keys, setKeys] = useState<ApiKeyItem[]>(() => {
    try {
      const saved = localStorage.getItem('ketner_api_keys');
      if (saved) return JSON.parse(saved) as ApiKeyItem[];
    } catch {
      // ignore
    }
    return DEFAULT_KEYS;
  });

  const [newKeyName, setNewKeyName] = useState('');
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [revealedKeyIds, setRevealedKeyIds] = useState<Record<string, boolean>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  // Активный ключ для подстановки в примеры кода
  const activeApiKey = keys[0]?.key || 'ketner_sk_live_your_api_key_here';

  useEffect(() => {
    try {
      localStorage.setItem('ketner_api_keys', JSON.stringify(keys));
    } catch {
      // ignore
    }
  }, [keys]);

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newKeyName.trim() || `API Key #${keys.length + 1}`;
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
    setNewKeyName('');
    setShowKeyForm(false);
  };

  const handleRevokeKey = (id: string) => {
    setKeys(keys.filter((k) => k.id !== id));
  };

  const toggleReveal = (id: string) => {
    setRevealedKeyIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyKey = async (id: string, text: string) => {
    await copyText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  // Мини-тестер API
  const [testModel, setTestModel] = useState('gpt-6-astra');
  const [testPrompt, setTestPrompt] = useState(
    'Проанализируй локальный репозиторий и создай скрипт для запуска тестов',
  );
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const handleRunTest = () => {
    setTestLoading(true);
    setTestResponse('');
    const fullText = `[Ketner AI Engine • ${testModel}]\n\nПодключение к хост-машине успешно установлено.\n\nПроект обнаружен в текущей директории:\n  ✔ Package Manager: npm (workspaces: apps/web, apps/mock-api)\n  ✔ Environment: Node.js >= 20.0, TypeScript 5.8\n  ✔ Test Runner: Vitest / Node test runner\n\nСгенерирован план выполнения задачи:\n1. Запуск статического анализаторов (eslint & tsc --noEmit)\n2. Запуск unit-тестов в изолированных потоках\n3. Готовность к исполнению локальных команд агентом.`;

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:px-8 animate-fade-in text-text">
      {/* Шапка и навигация */}
      <div className="flex flex-col gap-4 border-b border-stroke/20 pb-6">
        <div className="flex items-center gap-2 text-xs font-medium text-muted">
          <Link to="/docs" className="hover:text-text transition-colors flex items-center gap-1">
            <ArrowLeftIcon className="text-sm" />
            {t('nav.docs')}
          </Link>
          <span>/</span>
          <span className="text-text font-semibold">{t('nav.apiDocs')}</span>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-text flex items-center gap-2.5">
              <TerminalIcon className="text-accent text-3xl" />
              {t('apiDocs.title')}
            </h1>
            <p className="mt-1 text-sm md:text-base text-muted max-w-3xl leading-relaxed">
              {t('apiDocs.subtitle')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">OpenAI v1 Compatible</Badge>
            <Badge tone="neutral">MCP Protocol</Badge>
            <Badge tone="outline">CLI Daemon v1.4</Badge>
          </div>
        </div>
      </div>

      {/* БЛОК 1: Управление API-ключами */}
      <section className="flex flex-col gap-4 rounded-[16px] border border-stroke/30 bg-surface p-5 md:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stroke/20 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-[8px] bg-accent/15 text-accent">
              <KeyIcon className="text-xl" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text">{t('apiDocs.keysTitle')}</h2>
              <p className="text-xs text-muted">{t('apiDocs.keysDesc')}</p>
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowKeyForm((v) => !v)}
            className="self-start sm:self-center"
          >
            + {t('apiDocs.createKey')}
          </Button>
        </div>

        {/* Форма создания ключа */}
        {showKeyForm ? (
          <form
            onSubmit={handleCreateKey}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-[12px] border border-accent/30 bg-accent/5 p-3 animate-fade-in"
          >
            <input
              type="text"
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t('apiDocs.keyNamePlaceholder')}
              className="flex-1 rounded-[8px] border border-stroke/30 bg-canvas px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
            />
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" size="sm">
                Создать
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowKeyForm(false)}
              >
                Отмена
              </Button>
            </div>
          </form>
        ) : null}

        {/* Список ключей */}
        <div className="flex flex-col gap-2.5">
          {keys.map((k) => {
            const isRevealed = Boolean(revealedKeyIds[k.id]);
            const isCopied = copiedKeyId === k.id;
            const displayKey = isRevealed
              ? k.key
              : `${k.key.slice(0, 15)}••••••••••••••••••••••••••••`;

            return (
              <div
                key={k.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[10px] border border-stroke/20 bg-canvas p-3 transition-colors hover:border-stroke/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-text truncate">{k.name}</span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      {t('apiDocs.keyActive')}
                    </span>
                    <span className="text-[11px] text-muted hidden md:inline">
                      Создан: {k.createdAt}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 font-mono text-xs text-text/90">
                    <span className="rounded bg-surface px-2 py-0.5 border border-stroke/20 select-all">
                      {displayKey}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleReveal(k.id)}
                      title={isRevealed ? 'Скрыть' : 'Показать'}
                      className="p-1 text-muted hover:text-text transition-colors"
                    >
                      {isRevealed ? (
                        <EyeOffIcon className="text-sm" />
                      ) : (
                        <EyeIcon className="text-sm" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyKey(k.id, k.key)}
                    className="text-xs"
                  >
                    {isCopied ? (
                      <>
                        <CheckIcon className="text-emerald-500 text-sm" />
                        <span className="text-emerald-500">Скопировано</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon className="text-sm" />
                        <span>Копировать</span>
                      </>
                    )}
                  </Button>
                  {keys.length > 1 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevokeKey(k.id)}
                      className="text-xs text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    >
                      {t('apiDocs.revoke')}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted leading-relaxed">
          🔒 <strong className="text-text font-medium">Безопасность:</strong> Никогда не передавайте
          API-ключ в публичный доступ или git-репозиторий. Используйте переменные окружения (
          <code className="text-accent">KETNER_API_KEY</code>) или секреты вашей ОС.
        </p>
      </section>

      {/* БЛОК 2: Базовые параметры API */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-[14px] border border-stroke/20 bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Base URL (OpenAI V1)
          </p>
          <div className="mt-2 flex items-center justify-between gap-2 rounded-[8px] bg-canvas px-2.5 py-1.5 font-mono text-xs border border-stroke/20">
            <span className="truncate text-accent">https://api.ketner.ai/v1</span>
            <button
              type="button"
              onClick={() => copyText('https://api.ketner.ai/v1')}
              className="text-muted hover:text-text"
              title="Копировать Base URL"
            >
              <CopyIcon className="text-xs" />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Совместим с любыми библиотеками и IDE с поддержкой OpenAI spec.
          </p>
        </div>

        <div className="rounded-[14px] border border-stroke/20 bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Поддерживаемые модели
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="rounded bg-canvas border border-stroke/20 px-2 py-0.5 font-mono text-[11px] text-text">
              gpt-6-astra
            </span>
            <span className="rounded bg-canvas border border-stroke/20 px-2 py-0.5 font-mono text-[11px] text-text">
              claude-fable-5.5
            </span>
            <span className="rounded bg-canvas border border-stroke/20 px-2 py-0.5 font-mono text-[11px] text-text">
              gemini-3.8-pro
            </span>
            <span className="rounded bg-canvas border border-stroke/20 px-2 py-0.5 font-mono text-[11px] text-text">
              qwen-2.5-coder
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Указывайте имя модели в теле запроса или конфигурации IDE.
          </p>
        </div>

        <div className="rounded-[14px] border border-stroke/20 bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Протокол агента
          </p>
          <p className="mt-2 text-sm font-semibold text-text">SSE Streaming & Tool Calling</p>
          <p className="mt-1 text-[11px] text-muted leading-relaxed">
            Потоковый вывод токенов и поддержка вызова функций на хост-машине.
          </p>
        </div>
      </section>

      {/* БЛОК 3: Интерактивное руководство по интеграции */}
      <section className="flex flex-col gap-6 rounded-[16px] border border-stroke/30 bg-surface p-5 md:p-7 shadow-sm">
        {/* Переключатель табов */}
        <div className="flex flex-col gap-3 border-b border-stroke/20 pb-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-[12px] bg-canvas border border-stroke/20">
              <button
                type="button"
                onClick={() => setActiveTab('cli')}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'cli'
                    ? 'bg-accent text-[var(--color-accent-text)] font-semibold shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('apiDocs.tabCli')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ide')}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'ide'
                    ? 'bg-accent text-[var(--color-accent-text)] font-semibold shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('apiDocs.tabIde')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('mcp')}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'mcp'
                    ? 'bg-accent text-[var(--color-accent-text)] font-semibold shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('apiDocs.tabMcp')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sdk')}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'sdk'
                    ? 'bg-accent text-[var(--color-accent-text)] font-semibold shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('apiDocs.tabSdk')}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('security')}
                className={cn(
                  'rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors',
                  activeTab === 'security'
                    ? 'bg-accent text-[var(--color-accent-text)] font-semibold shadow-sm'
                    : 'text-muted hover:text-text',
                )}
              >
                {t('apiDocs.tabSecurity')}
              </button>
            </div>

            {/* Выбор операционной системы */}
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted mr-1">ОС:</span>
              {(['windows', 'macos', 'linux'] as const).map((osKey) => (
                <button
                  key={osKey}
                  type="button"
                  onClick={() => setOs(osKey)}
                  className={cn(
                    'rounded-[6px] px-2.5 py-1 capitalize transition-colors font-medium',
                    os === osKey
                      ? 'bg-surface border border-accent text-accent'
                      : 'text-muted hover:text-text border border-transparent',
                  )}
                >
                  {osKey === 'windows' ? 'Windows' : osKey === 'macos' ? 'macOS' : 'Linux'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ТАБ 1: KETNER CLI & ТЕРМИНАЛЬНЫЙ АГЕНТ */}
        {activeTab === 'cli' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div>
              <h3 className="text-xl font-bold text-text flex items-center gap-2">
                <TerminalIcon className="text-accent" />
                Ketner CLI: Запуск автономного агента в вашем терминале
              </h3>
              <p className="mt-1 text-sm text-muted leading-relaxed">
                Ketner CLI связывает модель ИИ с вашей локальной машиной: агент получает возможность
                напрямую читать и редактировать исходный код, запускать тесты, сборку и выполнять
                git-операции прямо в директории вашего проекта.
              </p>
            </div>

            {/* Шаг 1 */}
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-accent/20 text-accent text-xs font-bold">
                  1
                </span>
                Установка Ketner CLI на компьютер
              </h4>
              <p className="text-xs text-muted">
                Выберите команду для установки глобального пакета агента:
              </p>
              {os === 'windows' ? (
                <CodeSnippet
                  title="PowerShell (Windows)"
                  language="powershell"
                  code={`# Способ 1: Установка через npm (рекомендуется)
npm install -g @ketner/agent-cli

# Способ 2: Быстрая автоматическая установка через PowerShell
irm https://ketner.ai/install.ps1 | iex`}
                />
              ) : os === 'macos' ? (
                <CodeSnippet
                  title="Terminal (macOS)"
                  language="bash"
                  code={`# Способ 1: Через Homebrew
brew install ketner-ai/tap/ketner

# Способ 2: Через npm
npm install -g @ketner/agent-cli

# Способ 3: Через cURL скрипт
curl -fsSL https://ketner.ai/install.sh | bash`}
                />
              ) : (
                <CodeSnippet
                  title="Bash (Linux)"
                  language="bash"
                  code={`# Способ 1: Через официальный скрипт установки
curl -fsSL https://ketner.ai/install.sh | bash

# Способ 2: Через npm
npm install -g @ketner/agent-cli`}
                />
              )}
            </div>

            {/* Шаг 2 */}
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-accent/20 text-accent text-xs font-bold">
                  2
                </span>
                Авторизация агента через ваш API-ключ
              </h4>
              <p className="text-xs text-muted">
                Сохраните ключ в переменных окружения или пройдите быстрый вход в CLI:
              </p>
              {os === 'windows' ? (
                <CodeSnippet
                  title="PowerShell"
                  language="powershell"
                  code={`# Вариант А: Быстрый интерактивный вход
ketner auth login

# Вариант Б: Установка системной переменной (сохраняется навсегда)
[System.Environment]::SetEnvironmentVariable('KETNER_API_KEY', '${activeApiKey}', 'User')
$env:KETNER_API_KEY = '${activeApiKey}'`}
                />
              ) : (
                <CodeSnippet
                  title="Zsh / Bash"
                  language="bash"
                  code={`# Вариант А: Интерактивный вход
ketner auth login

# Вариант Б: Экспорт переменной в файл профиля (~/.zshrc или ~/.bashrc)
echo 'export KETNER_API_KEY="${activeApiKey}"' >> ~/.zshrc
source ~/.zshrc`}
                />
              )}
            </div>

            {/* Шаг 3 */}
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-accent/20 text-accent text-xs font-bold">
                  3
                </span>
                Запуск агента в папке вашего проекта
              </h4>
              <p className="text-xs text-muted">
                Перейдите в репозиторий проекта и вызовите агента для выполнения задачи:
              </p>
              <CodeSnippet
                title="Terminal"
                language="bash"
                code={`# Перейдите в корень вашего проекта
cd ~/projects/my-awesome-app

# 1. Запуск интерактивной сессии с агентом
ketner run --model gpt-6-astra

# 2. Передача конкретной команды напрямую
ketner run "Найди и исправь падающие тесты в auth-flow.test.tsx и запусти npm test"

# 3. Запуск фонового демона с локальным Web UI на http://localhost:4040
ketner agent start --port 4040 --workspace .`}
              />
            </div>

            {/* Возможности */}
            <div className="rounded-[12px] border border-stroke/20 bg-canvas p-4">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">
                Что агент может делать на вашей машине:
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs text-text/90">
                <div className="flex items-start gap-2">
                  <CheckIcon className="text-accent shrink-0 mt-0.5" />
                  <span>
                    <strong>Чтение и правка кода:</strong> Интеллектуальный поиск по AST, правка
                    только нужных фрагментов без потери форматирования.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckIcon className="text-accent shrink-0 mt-0.5" />
                  <span>
                    <strong>Выполнение команд:</strong> Запуск тестов, сборщиков, линтеров и парсинг
                    стека ошибок в реальном времени.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckIcon className="text-accent shrink-0 mt-0.5" />
                  <span>
                    <strong>Интеграция с Git:</strong> Создание веток, инспекция `git diff`,
                    формирование информативных сообщений коммитов.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckIcon className="text-accent shrink-0 mt-0.5" />
                  <span>
                    <strong>Автономный дебаг:</strong> Запускает упавший тест, правит причину ошибки
                    и повторяет прогон до победного конца.
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ТАБ 2: ПОДКЛЮЧЕНИЕ К IDE */}
        {activeTab === 'ide' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div>
              <h3 className="text-xl font-bold text-text flex items-center gap-2">
                <CpuIcon className="text-accent" />
                Интеграция с Cursor, VS Code (Cline / Continue) и Windsurf
              </h3>
              <p className="mt-1 text-sm text-muted leading-relaxed">
                Ketner AI полностью совместим со спецификацией OpenAI API. Вы можете использовать
                наши флагманские модели (GPT-6 Astra, Claude Fable 5.5, Gemini 3.8 Pro) напрямую
                внутри вашей любимой среды разработки.
              </p>
            </div>

            {/* Cursor */}
            <div className="rounded-[14px] border border-stroke/20 bg-canvas p-4.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm text-text flex items-center gap-2">
                  <span className="size-2 rounded-full bg-accent" />
                  Настройка в Cursor AI
                </h4>
                <Badge tone="brand">Cursor</Badge>
              </div>
              <ol className="list-decimal list-inside text-xs text-muted flex flex-col gap-1.5 leading-relaxed">
                <li>
                  Откройте настройки Cursor: <code className="text-text">Cursor Settings</code> →{' '}
                  <code className="text-text">Models</code>.
                </li>
                <li>
                  Включите тумблер <strong>OpenAI API Key</strong> или нажмите{' '}
                  <strong>Add Model</strong>.
                </li>
                <li>
                  В поле <strong>Override OpenAI Base URL</strong> введите:{' '}
                  <code className="text-accent font-semibold">https://api.ketner.ai/v1</code>
                </li>
                <li>
                  В поле <strong>API Key</strong> вставьте ваш ключ:{' '}
                  <code className="text-text font-mono">{activeApiKey}</code>
                </li>
                <li>
                  В списке моделей укажите: <code className="text-text font-mono">gpt-6-astra</code>
                  , <code className="text-text font-mono">claude-fable-5.5</code>,{' '}
                  <code className="text-text font-mono">gemini-3.8-pro</code>.
                </li>
              </ol>
            </div>

            {/* VS Code: Cline / Roo Code / Continue */}
            <div className="rounded-[14px] border border-stroke/20 bg-canvas p-4.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm text-text flex items-center gap-2">
                  <span className="size-2 rounded-full bg-emerald-500" />
                  Настройка в VS Code (Cline, Roo Code или Continue.dev)
                </h4>
                <Badge tone="neutral">VS Code</Badge>
              </div>
              <p className="text-xs text-muted">
                Вставьте этот фрагмент в конфигурационный файл расширения{' '}
                <code className="text-text font-mono">config.json</code>:
              </p>
              <CodeSnippet
                title="~/.continue/config.json"
                language="json"
                code={`{
  "models": [
    {
      "title": "Ketner GPT-6 Astra",
      "provider": "openai",
      "model": "gpt-6-astra",
      "apiBase": "https://api.ketner.ai/v1",
      "apiKey": "${activeApiKey}"
    },
    {
      "title": "Ketner Claude Fable 5.5",
      "provider": "openai",
      "model": "claude-fable-5.5",
      "apiBase": "https://api.ketner.ai/v1",
      "apiKey": "${activeApiKey}"
    },
    {
      "title": "Ketner Gemini 3.8 Pro",
      "provider": "openai",
      "model": "gemini-3.8-pro",
      "apiBase": "https://api.ketner.ai/v1",
      "apiKey": "${activeApiKey}"
    }
  ]
}`}
              />
            </div>
          </div>
        )}

        {/* ТАБ 3: MCP ПРОТОКОЛ */}
        {activeTab === 'mcp' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div>
              <h3 className="text-xl font-bold text-text flex items-center gap-2">
                <SparkleIcon className="text-accent" />
                MCP (Model Context Protocol): Подключение системных инструментов
              </h3>
              <p className="mt-1 text-sm text-muted leading-relaxed">
                <strong>Model Context Protocol (MCP)</strong> — открытый стандарт от Anthropic,
                позволяющий безопасно предоставить ИИ-агенту доступ к локальным базам данных,
                файловой системе, терминалу, браузеру и API сторонних сервисов.
              </p>
            </div>

            {/* Пути к конфигу */}
            <div className="rounded-[12px] border border-stroke/20 bg-canvas p-3.5 text-xs text-muted">
              <span className="font-semibold text-text">Где находится файл конфигурации MCP:</span>
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

            {/* Полный конфиг */}
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text">
                Готовый файл claude_desktop_config.json
              </h4>
              <p className="text-xs text-muted">
                Этот конфигурационный файл подключает сервер агента Ketner AI, доступ к файловой
                системе и локальной базе SQLite:
              </p>
              <CodeSnippet
                title="claude_desktop_config.json"
                language="json"
                code={`{
  "mcpServers": {
    "ketner-ai": {
      "command": "npx",
      "args": ["-y", "@ketner/mcp-server@latest"],
      "env": {
        "KETNER_API_KEY": "${activeApiKey}",
        "KETNER_BASE_URL": "https://api.ketner.ai/v1",
        "DEFAULT_MODEL": "gpt-6-astra"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${os === 'windows' ? 'C:\\\\Users\\\\admin\\\\Projects' : '/Users/admin/projects'}"
      ]
    },
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./app.db"]
    }
  }
}`}
              />
            </div>

            <div className="rounded-[12px] border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-700 dark:text-amber-300">
              <p className="font-semibold flex items-center gap-1.5">
                <span>💡</span> Как проверить работу MCP:
              </p>
              <p className="mt-1 leading-relaxed">
                После перезапуска приложения Claude Desktop или Cursor внизу в строке ввода появится
                иконка молотка (Tools) со списком доступных инструментов: чтение файлов, выполнение
                SQL-запросов и вызов агента Ketner.
              </p>
            </div>
          </div>
        )}

        {/* ТАБ 4: PYTHON / NODE SDK */}
        {activeTab === 'sdk' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div>
              <h3 className="text-xl font-bold text-text flex items-center gap-2">
                <TerminalIcon className="text-accent" />
                Программный доступ: Python, Node.js и cURL
              </h3>
              <p className="mt-1 text-sm text-muted leading-relaxed">
                Поскольку платформа полностью повторяет протокол OpenAI, вам не требуется учить
                новые проприетарные SDK — просто используйте официальные библиотеки{' '}
                <code className="text-text">openai</code> на любом языке.
              </p>
            </div>

            {/* Python */}
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <span>🐍</span> Python (с потоковым выводом)
              </h4>
              <CodeSnippet
                title="agent_example.py"
                language="python"
                code={`import os
from openai import OpenAI

# Инициализируем клиент с эндпоинтом Ketner AI
client = OpenAI(
    base_url="https://api.ketner.ai/v1",
    api_key=os.environ.get("KETNER_API_KEY", "${activeApiKey}"),
)

print("Запрос к GPT-6 Astra на локальной машине...")

# Запуск стриминга ответа
stream = client.chat.completions.create(
    model="gpt-6-astra",
    messages=[
        {
            "role": "system",
            "content": "Ты автономный AI-ассистент разработчика. Твой код точен и сразу готов к запуску.",
        },
        {
            "role": "user",
            "content": "Напиши функцию на Python для параллельной загрузки 10 файлов через asyncio",
        },
    ],
    stream=True,
)

for chunk in stream:
    token = chunk.choices[0].delta.content or ""
    print(token, end="", flush=True)

print()
`}
              />
            </div>

            {/* Node.js / TypeScript */}
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <span>⚡</span> Node.js / TypeScript
              </h4>
              <CodeSnippet
                title="agent_runner.ts"
                language="typescript"
                code={`import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.ketner.ai/v1',
  apiKey: process.env.KETNER_API_KEY || '${activeApiKey}',
});

async function main() {
  const stream = await client.chat.completions.create({
    model: 'claude-fable-5.5',
    messages: [{ role: 'user', content: 'Оптимизируй этот SQL-запрос для PostgreSQL' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

main().catch(console.error);
`}
              />
            </div>

            {/* cURL */}
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold text-text flex items-center gap-2">
                <span>🌐</span> Прямой cURL-запрос (Server-Sent Events)
              </h4>
              <CodeSnippet
                title="Terminal"
                language="bash"
                code={`curl https://api.ketner.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${activeApiKey}" \\
  -d '{
    "model": "gpt-6-astra",
    "messages": [{"role": "user", "content": "Привет, Ketner AI!"}],
    "stream": true
  }'`}
              />
            </div>
          </div>
        )}

        {/* ТАБ 5: БЕЗОПАСНОСТЬ НА МАШИНЕ */}
        {activeTab === 'security' && (
          <div className="flex flex-col gap-6 animate-fade-in">
            <div>
              <h3 className="text-xl font-bold text-text flex items-center gap-2">
                <span>🛡️</span>
                Политика безопасности и контроль доступа на локальной машине
              </h3>
              <p className="mt-1 text-sm text-muted leading-relaxed">
                Предоставление автономному агенту доступа к терминалу и файлам требует строгих
                гарантий безопасности. Ketner AI реализует эшелонированную защиту вашей рабочей
                станции.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-[14px] border border-stroke/20 bg-canvas p-4.5 flex flex-col gap-2">
                <h4 className="font-semibold text-sm text-text flex items-center gap-2">
                  <span>✋</span> Режим подтверждения (Human-in-the-loop)
                </h4>
                <p className="text-xs text-muted leading-relaxed">
                  По умолчанию агент <strong>не может</strong> исполнять деструктивные команды без
                  вашего подтверждения в терминале. При попытке выполнить операции вроде{' '}
                  <code className="text-text">git push</code>, <code className="text-text">rm</code>{' '}
                  или установку глобальных пакетов терминал запрашивает подтверждение клавишей{' '}
                  <kbd className="text-text font-bold">Y</kbd>.
                </p>
              </div>

              <div className="rounded-[14px] border border-stroke/20 bg-canvas p-4.5 flex flex-col gap-2">
                <h4 className="font-semibold text-sm text-text flex items-center gap-2">
                  <span>🔒</span> Защита секретов и токенов
                </h4>
                <p className="text-xs text-muted leading-relaxed">
                  Агент автоматически маскирует и исключает из контекста отправки файлы секретов:{' '}
                  <code className="text-text font-mono">.env</code>,{' '}
                  <code className="text-text font-mono">id_rsa</code>,{' '}
                  <code className="text-text font-mono">credentials.json</code> и каталог{' '}
                  <code className="text-text font-mono">.git/config</code>. Ваши приватные ключи
                  никогда не покидают компьютер.
                </p>
              </div>

              <div className="rounded-[14px] border border-stroke/20 bg-canvas p-4.5 flex flex-col gap-2">
                <h4 className="font-semibold text-sm text-text flex items-center gap-2">
                  <span>🐳</span> Изоляция через Docker / Dev Containers
                </h4>
                <p className="text-xs text-muted leading-relaxed">
                  Для 100% изоляции вы можете запустить Ketner Agent внутри изолированного
                  Docker-контейнера:
                  <br />
                  <code className="text-accent text-[11px] font-mono mt-1 block">
                    docker run -v $(pwd):/workspace ketner/agent:latest
                  </code>
                </p>
              </div>

              <div className="rounded-[14px] border border-stroke/20 bg-canvas p-4.5 flex flex-col gap-2">
                <h4 className="font-semibold text-sm text-text flex items-center gap-2">
                  <span>🚫</span> Чёрный список команд (Blacklist)
                </h4>
                <p className="text-xs text-muted leading-relaxed">
                  Системный фильтр ядра блокирует любые попытки изменения системных разделов
                  (форматирование, модификация BIOS/EFI, изменение прав суперпользователя).
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* БЛОК 4: Интерактивный тест API */}
      <section className="flex flex-col gap-4 rounded-[16px] border border-stroke/30 bg-surface p-5 md:p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-stroke/20 pb-3">
          <div className="flex items-center gap-2">
            <SparkleIcon className="text-accent text-lg" />
            <h3 className="font-semibold text-sm text-text">
              Быстрая проверка API (Live Playground)
            </h3>
          </div>
          <span className="text-xs text-muted font-mono">POST /v1/chat/completions</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Модель для запроса</label>
            <select
              value={testModel}
              onChange={(e) => setTestModel(e.target.value)}
              className="w-full rounded-[8px] border border-stroke/30 bg-canvas px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent"
            >
              <option value="gpt-6-astra">GPT-6 Astra * (Флагман OpenAI)</option>
              <option value="claude-fable-5.5">Claude Fable 5.5 * (Код & Архитектура)</option>
              <option value="gemini-3.8-pro">Gemini 3.8 Pro * (2M токенов)</option>
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
                className="w-full rounded-[8px] border border-stroke/30 bg-canvas px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
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
          <div className="mt-2 rounded-[10px] border border-stroke/20 bg-[#121212] p-3 text-xs font-mono text-emerald-400 whitespace-pre-wrap leading-relaxed animate-fade-in shadow-inner">
            {testResponse}
            {testLoading && (
              <span className="inline-block size-2 bg-emerald-400 animate-pulse ml-1" />
            )}
          </div>
        )}
      </section>

      {/* Футер страницы со ссылкой в чат и к тарифам */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-stroke/20 pt-6 pb-4 text-xs text-muted">
        <span>Ketner AI Developer Hub · OpenAI-Compatible Platform</span>
        <div className="flex items-center gap-4">
          <Link to="/chat" className="hover:text-text transition-colors">
            Перейти в чат
          </Link>
          <span>•</span>
          <Link to="/pricing" className="hover:text-text transition-colors">
            Тарифы и лимиты
          </Link>
          <span>•</span>
          <Link to="/docs" className="hover:text-text transition-colors">
            Документация
          </Link>
        </div>
      </div>
    </div>
  );
}
