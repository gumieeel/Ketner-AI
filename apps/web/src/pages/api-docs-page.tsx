import { useEffect, useState } from 'react';
import { CpuIcon, SparkleIcon, TerminalIcon } from '@/components/icons';
import { Callout } from '@/components/docs/callout';
import { CodeTabs } from '@/components/docs/code-tabs';
import { DocSection } from '@/components/docs/doc-section';
import { DocsLayout } from '@/components/docs/docs-layout';
import { useScrollSpy } from '@/components/docs/use-scroll-spy';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { RichText } from '@/components/ui/rich-text';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
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

const API_DOCS_NAV: ReadonlyArray<{ id: string; label: TranslationKey }> = [
  { id: 'overview', label: 'apiDocs.navOverview' },
  { id: 'keys', label: 'apiDocs.navKeys' },
  { id: 'base-url', label: 'apiDocs.navBaseUrl' },
  { id: 'cli', label: 'apiDocs.navCli' },
  { id: 'ide', label: 'apiDocs.navIde' },
  { id: 'mcp', label: 'apiDocs.navMcp' },
  { id: 'sdk', label: 'apiDocs.navSdk' },
  { id: 'endpoint-completions', label: 'apiDocs.navCompletions' },
  { id: 'endpoint-conversations', label: 'apiDocs.navConversations' },
  { id: 'security', label: 'apiDocs.navSecurity' },
  { id: 'playground', label: 'apiDocs.navPlayground' },
];

const MODEL_IDS = ['gpt-6-astra', 'claude-fable-5.5', 'gemini-3.8-pro', 'qwen-2.5-coder'] as const;
const API_BASE_URL = 'https://api.ketner.ai/v1';

/** Метка карточки в блоке «Базовые параметры». */
const LABEL_CLASS = 'text-[13px] font-medium text-muted';

/** Номер шага в инструкции. */
function StepNumber({ value }: { value: number }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
      {value}
    </span>
  );
}

export function ApiDocsPage() {
  const { t } = useTranslation();
  const [os, setOs] = useState<OsType>('windows');
  const activeId = useScrollSpy(API_DOCS_NAV.map((item) => item.id));

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
  const navItems = API_DOCS_NAV.map((item) => ({ id: item.id, label: t(item.label) }));

  return (
    <DocsLayout nav={navItems} activeId={activeId}>
      <div className="flex flex-col gap-6 md:gap-8">
        {/* Заголовок страницы */}
        <section
          id="overview"
          className="flex scroll-mt-32 flex-col gap-4 border-b border-stroke pb-6 xl:scroll-mt-24"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">OpenAI v1 Compatible</Badge>
            <Badge tone="neutral">MCP Protocol</Badge>
            <Badge tone="outline">CLI Daemon v1.4</Badge>
          </div>

          <h1 className="flex items-start gap-3 text-[26px] font-semibold leading-tight tracking-tight text-balance text-text md:text-3xl">
            <TerminalIcon className="mt-0.5 size-7 shrink-0 text-accent md:size-8" />
            {t('apiDocs.title')}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted md:text-base md:leading-7">
            {t('apiDocs.subtitle')}
          </p>
        </section>

        {/* Секретные API-ключи */}
        <KeysSection keys={keys} onAddKey={handleAddKey} onRevokeKey={handleRevokeKey} />

        {/* Базовые параметры API */}
        <section
          id="base-url"
          className="grid scroll-mt-32 grid-cols-1 gap-3 md:gap-4 lg:grid-cols-3 xl:scroll-mt-24"
        >
          <div className="rounded-2xl border border-stroke bg-surface p-4 shadow-sm">
            <p className={LABEL_CLASS}>{t('apiDocs.baseUrlLabel')}</p>
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-stroke bg-canvas py-1 pr-1 pl-3">
              <code className="truncate font-mono text-xs font-medium text-accent">{API_BASE_URL}</code>
              <CopyButton value={API_BASE_URL} label={t('apiDocs.baseUrlCopy')} size="sm" />
            </div>
            <p className="mt-2.5 text-xs leading-5 text-muted">{t('apiDocs.baseUrlHint')}</p>
          </div>

          <div className="rounded-2xl border border-stroke bg-surface p-4 shadow-sm">
            <p className={LABEL_CLASS}>{t('apiDocs.modelsLabel')}</p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {MODEL_IDS.map((modelId) => (
                <li
                  key={modelId}
                  className="rounded-lg border border-stroke bg-canvas px-2 py-1 font-mono text-xs text-text"
                >
                  {modelId}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-xs leading-5 text-muted">{t('apiDocs.modelsHint')}</p>
          </div>

          <div className="rounded-2xl border border-stroke bg-surface p-4 shadow-sm">
            <p className={LABEL_CLASS}>{t('apiDocs.protocolLabel')}</p>
            <p className="mt-2.5 text-sm font-semibold text-text">SSE Streaming &amp; Tool Calling</p>
            <p className="mt-1.5 text-xs leading-5 text-muted">{t('apiDocs.protocolHint')}</p>
          </div>
        </section>

        {/* Ketner CLI */}
        <DocSection
          id="cli"
          icon={<TerminalIcon className="size-5" />}
          title={t('apiDocs.cliTitle')}
          description={t('apiDocs.cliDesc')}
          aside={
            <div
              role="group"
              aria-label={t('apiDocs.osLabel')}
              className="flex items-center gap-1 rounded-xl border border-stroke bg-canvas p-1"
            >
              <span className="px-2 text-xs text-muted">{t('apiDocs.osLabel')}</span>
              {(['windows', 'macos', 'linux'] as const).map((osKey) => (
                <button
                  key={osKey}
                  type="button"
                  aria-pressed={os === osKey}
                  onClick={() => setOs(osKey)}
                  className={cn(
                    'min-h-9 rounded-lg px-3 text-[13px] font-medium transition-colors max-md:min-h-11',
                    os === osKey
                      ? 'bg-surface text-accent shadow-xs ring-1 ring-stroke ring-inset'
                      : 'text-muted hover:text-text',
                  )}
                >
                  {osKey === 'windows' ? 'Windows' : osKey === 'macos' ? 'macOS' : 'Linux'}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2.5 text-sm font-semibold text-text">
                <StepNumber value={1} />
                {t('apiDocs.cliStep1')}
              </h3>
              <p className="text-[13px] text-muted">{t('apiDocs.cliStep1Hint')}</p>
              <CodeTabs
                className="my-0"
                tabs={[
                  { id: 'powershell', label: 'PowerShell (Windows)', language: 'powershell', code: cliInstallSnippets.powershell },
                  { id: 'macos', label: 'Terminal (macOS)', language: 'bash', code: cliInstallSnippets.macos },
                  { id: 'linux', label: 'Bash (Linux)', language: 'bash', code: cliInstallSnippets.linux },
                ]}
                defaultTabId={os === 'windows' ? 'powershell' : os}
              />
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2.5 text-sm font-semibold text-text">
                <StepNumber value={2} />
                {t('apiDocs.cliStep2')}
              </h3>
              <p className="text-[13px] text-muted">{t('apiDocs.cliStep2Hint')}</p>
              <CodeTabs
                className="my-0"
                tabs={[
                  { id: 'powershell', label: 'PowerShell', language: 'powershell', code: cliAuthSnippets.powershell },
                  { id: 'bash', label: 'Zsh / Bash', language: 'bash', code: cliAuthSnippets.bash },
                ]}
                defaultTabId={os === 'windows' ? 'powershell' : 'bash'}
              />
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2.5 text-sm font-semibold text-text">
                <StepNumber value={3} />
                {t('apiDocs.cliStep3')}
              </h3>
              <CodeTabs
                className="my-0"
                tabs={[{ id: 'run', label: t('apiDocs.cliTerminalTab'), language: 'bash', code: CLI_RUN_SNIPPET }]}
              />
            </div>
          </div>
        </DocSection>

        {/* Интеграция с IDE */}
        <DocSection
          id="ide"
          icon={<CpuIcon className="size-5" />}
          title={t('apiDocs.ideTitle')}
          description={t('apiDocs.ideDesc')}
        >
          <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-canvas p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text">{t('apiDocs.ideCursorTitle')}</h3>
              <Badge tone="brand">Cursor</Badge>
            </div>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-6 text-muted marker:text-subtle">
              <li><RichText text={t('apiDocs.ideCursor1')} /></li>
              <li><RichText text={t('apiDocs.ideCursor2')} /></li>
              <li><RichText text={t('apiDocs.ideCursor3', { url: API_BASE_URL })} /></li>
              <li className="break-all"><RichText text={t('apiDocs.ideCursor4', { key: activeApiKey })} /></li>
              <li><RichText text={t('apiDocs.ideCursor5')} /></li>
            </ol>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-canvas p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text">{t('apiDocs.ideVsTitle')}</h3>
              <Badge tone="neutral" className="shrink-0">VS Code</Badge>
            </div>
            <p className="text-[13px] leading-6 text-muted">
              <RichText text={t('apiDocs.ideVsHint')} />
            </p>
            <CodeTabs
              className="my-0"
              tabs={[
                { id: 'config', label: '~/.continue/config.json', language: 'json', code: getContinueConfigSnippet(activeApiKey) },
              ]}
            />
          </div>
        </DocSection>

        {/* MCP */}
        <DocSection
          id="mcp"
          icon={<SparkleIcon className="size-5" />}
          title={t('apiDocs.mcpTitle')}
          description={t('apiDocs.mcpDesc')}
        >
          <div className="rounded-xl border border-stroke bg-canvas p-4 text-[13px] text-muted">
            <span className="font-semibold text-text">{t('apiDocs.mcpPathsTitle')}</span>
            <ul className="mt-2 flex flex-col gap-1.5 font-mono text-xs">
              <li className="break-all">
                <strong className="text-text">Windows:</strong>{' '}
                <span className="text-accent">%APPDATA%\Claude\claude_desktop_config.json</span>
              </li>
              <li className="break-all">
                <strong className="text-text">macOS:</strong>{' '}
                <span className="text-accent">~/Library/Application Support/Claude/claude_desktop_config.json</span>
              </li>
              <li className="break-all">
                <strong className="text-text">Linux:</strong>{' '}
                <span className="text-accent">~/.config/claude/claude_desktop_config.json</span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-text">{t('apiDocs.mcpReadyFile')}</h3>
            <CodeTabs
              className="my-0"
              tabs={[
                { id: 'mcp-config', label: 'claude_desktop_config.json', language: 'json', code: getMcpConfigSnippet(activeApiKey, os) },
              ]}
            />
          </div>

          <Callout tone="info" title={t('apiDocs.mcpCheckTitle')} className="my-0">
            {t('apiDocs.mcpCheckText')}
          </Callout>
        </DocSection>

        {/* SDK и примеры */}
        <DocSection
          id="sdk"
          icon={<TerminalIcon className="size-5" />}
          title={t('apiDocs.sdkTitle')}
          description={t('apiDocs.sdkDesc')}
        >
          <CodeTabs className="my-0" tabs={sdkSnippets} />
        </DocSection>

        {/* Эндпоинты */}
        <EndpointCompletions apiKey={activeApiKey} />
        <EndpointConversations apiKey={activeApiKey} />

        {/* Безопасность */}
        <SecuritySection />

        {/* Playground */}
        <PlaygroundSection />

        {/* Подвал страницы */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-stroke pt-6 pb-2 text-sm text-muted sm:flex-row">
          <span>Ketner AI Developer Hub · OpenAI-Compatible Platform</span>
          <nav className="flex items-center gap-1">
            <a href="/chat" className="inline-flex min-h-11 items-center rounded-md px-3 transition-colors hover:text-text">
              {t('nav.chat')}
            </a>
            <a href="/pricing" className="inline-flex min-h-11 items-center rounded-md px-3 transition-colors hover:text-text">
              {t('nav.pricing')}
            </a>
            <a href="/docs" className="inline-flex min-h-11 items-center rounded-md px-3 transition-colors hover:text-text">
              {t('nav.docs')}
            </a>
          </nav>
        </div>
      </div>
    </DocsLayout>
  );
}
