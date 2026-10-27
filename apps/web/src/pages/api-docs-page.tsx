import { useState } from 'react';
import { CpuIcon, TerminalIcon } from '@/components/icons';
import { Callout } from '@/components/docs/callout';
import { CodeTabs } from '@/components/docs/code-tabs';
import { DocSection } from '@/components/docs/doc-section';
import { DocsLayout } from '@/components/docs/docs-layout';
import { MethodBadge } from '@/components/docs/method-badge';
import { ParamTable, type ParamDef } from '@/components/docs/param-table';
import { useScrollSpy } from '@/components/docs/use-scroll-spy';
import { CopyButton } from '@/components/ui/copy-button';
import { RichText } from '@/components/ui/rich-text';
import { apiBaseUrl } from '@/features/api-keys/api';
import { DEFAULT_MODELS } from '@/features/chat/model-catalog';
import { useTranslation, type TranslationKey } from '@/i18n';
import { KeysSection } from './api-docs/keys-section';
import {
  KEY_PLACEHOLDER,
  getContinueConfigSnippet,
  getModelsSnippet,
  getQuickstartSnippets,
  getStructuredSnippet,
  getToolsSnippet,
} from './api-docs/snippets';

const NAV: ReadonlyArray<{ id: string; label: TranslationKey }> = [
  { id: 'keys', label: 'dev.navKeys' },
  { id: 'base-url', label: 'dev.navBase' },
  { id: 'quickstart', label: 'dev.navQuick' },
  { id: 'editors', label: 'dev.navEditors' },
  { id: 'endpoint-completions', label: 'dev.navCompletions' },
  { id: 'endpoint-models', label: 'dev.navModels' },
];

/** id моделей для поля model: auto и публичный каталог (то же зеркало, что у выбора модели в чате). */
const MODEL_IDS = DEFAULT_MODELS.map((model) => model.id);

/**
 * Страница OpenAI-совместимого API: настоящие ключи (/api/keys), адрес /v1 этого же сайта,
 * примеры для SDK и редакторов. Только то, что сервер действительно умеет.
 */
export function ApiDocsPage() {
  const { t } = useTranslation();
  const activeId = useScrollSpy(NAV.map((item) => item.id));
  const [secret, setSecret] = useState<string | null>(null);

  const baseUrl = apiBaseUrl();
  const key = secret ?? KEY_PLACEHOLDER;
  const navItems = NAV.map((item) => ({ id: item.id, label: t(item.label) }));

  const params: ParamDef[] = [
    { name: 'model', type: 'string', required: true, description: t('dev.paramModel') },
    { name: 'messages', type: 'array', required: true, description: t('dev.paramMessages') },
    { name: 'tools', type: 'array', description: t('dev.paramTools') },
    {
      name: 'tool_choice',
      type: 'string | object',
      default: 'auto',
      description: t('dev.paramToolChoice'),
    },
    { name: 'stream', type: 'boolean', default: 'false', description: t('dev.paramStream') },
    { name: 'max_tokens', type: 'integer', description: t('dev.paramMaxTokens') },
    { name: 'temperature', type: 'number', description: t('dev.paramTemperature') },
    { name: 'top_p', type: 'number', description: t('dev.paramTopP') },
    { name: 'stop', type: 'string | array', description: t('dev.paramStop') },
    { name: 'seed', type: 'integer', description: t('dev.paramSeed') },
    {
      name: 'frequency_penalty, presence_penalty',
      type: 'number',
      default: '0',
      description: t('dev.paramPenalties'),
    },
    { name: 'response_format', type: 'object', description: t('dev.paramResponseFormat') },
    { name: 'stream_options', type: 'object', description: t('dev.paramStreamOptions') },
  ];

  return (
    <DocsLayout nav={navItems} activeId={activeId}>
      <div className="flex flex-col gap-6 md:gap-8">
        <header className="flex flex-col gap-4 border-b border-stroke pb-6">
          <h1 className="t-display text-[clamp(2.25rem,3.4vw+1rem,3.5rem)] text-text">
            {t('dev.title')}
          </h1>
          <p className="max-w-[62ch] text-[17px] leading-relaxed text-muted">{t('dev.lead')}</p>
        </header>

        <KeysSection onSecretCreated={setSecret} />

        <section
          id="base-url"
          className="grid scroll-mt-32 grid-cols-1 gap-3 md:grid-cols-2 xl:scroll-mt-24"
        >
          <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5">
            <h2 className="text-[17px] font-medium text-text">{t('dev.baseTitle')}</h2>
            <div className="flex items-center justify-between gap-2 rounded-md border border-stroke bg-canvas py-1 pr-1 pl-3">
              <code className="truncate font-mono text-[13px] text-text">{baseUrl}</code>
              <CopyButton value={baseUrl} label={t('dev.baseCopy')} size="sm" />
            </div>
            <p className="text-[14px] leading-relaxed text-muted">{t('dev.baseHint')}</p>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5">
            <h2 className="text-[17px] font-medium text-text">{t('dev.modelsTitle')}</h2>
            <ul className="flex flex-wrap gap-1.5">
              {MODEL_IDS.map((id) => (
                <li
                  key={id}
                  className="rounded-xs border border-stroke bg-canvas px-2 py-1 font-mono text-[12px] text-text"
                >
                  {id}
                </li>
              ))}
            </ul>
            <p className="text-[14px] leading-relaxed text-muted">{t('dev.modelsHint')}</p>
          </div>
        </section>

        <DocSection
          id="quickstart"
          icon={<TerminalIcon className="size-5" />}
          title={t('dev.quickTitle')}
          description={t('dev.quickDesc')}
        >
          {secret ? <p className="text-[14px] text-muted">{t('dev.quickKeyHint')}</p> : null}
          <CodeTabs
            className="my-0"
            tabs={getQuickstartSnippets(baseUrl, key, t('dev.quickPrompt'))}
          />
        </DocSection>

        <DocSection
          id="editors"
          icon={<CpuIcon className="size-5" />}
          title={t('dev.editorsTitle')}
          description={t('dev.editorsDesc')}
        >
          <div className="flex flex-col gap-3 rounded-lg border border-stroke bg-canvas p-4">
            <h3 className="text-[15px] font-medium text-text">{t('dev.cursorTitle')}</h3>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-6 text-muted marker:text-subtle">
              <li>
                <RichText text={t('dev.cursor1')} />
              </li>
              <li>
                <RichText text={t('dev.cursor2')} />
              </li>
              <li className="break-all">
                <RichText text={t('dev.cursor3', { url: baseUrl })} />
              </li>
              <li>
                <RichText text={t('dev.cursor4')} />
              </li>
            </ol>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-stroke bg-canvas p-4">
            <h3 className="text-[15px] font-medium text-text">{t('dev.continueTitle')}</h3>
            <p className="text-[14px] text-muted">
              <RichText text={t('dev.continueHint')} />
            </p>
            <CodeTabs
              className="my-0"
              tabs={[
                {
                  id: 'continue',
                  label: 'config.yaml',
                  language: 'yaml',
                  code: getContinueConfigSnippet(baseUrl, key),
                },
              ]}
            />
          </div>
        </DocSection>

        <DocSection
          id="endpoint-completions"
          icon={<MethodBadge method="POST" />}
          bareIcon
          monoTitle
          title="/v1/chat/completions"
          description={t('dev.navCompletions')}
        >
          <p className="max-w-[70ch] text-[15px] leading-relaxed text-muted">
            {t('dev.completionsLead')}
          </p>
          <div>
            <h3 className="mb-2 text-[15px] font-medium text-text">{t('dev.paramsTitle')}</h3>
            <ParamTable params={params} className="my-0" />
          </div>
          <div>
            <h3 className="mb-2 text-[15px] font-medium text-text">{t('dev.examplesTitle')}</h3>
            <CodeTabs className="my-0" tabs={getToolsSnippet(baseUrl, key)} />
          </div>
          <div>
            <h3 className="mb-2 text-[15px] font-medium text-text">{t('dev.structuredTitle')}</h3>
            <p className="mb-3 max-w-[70ch] text-[14px] leading-relaxed text-muted">
              <RichText text={t('dev.structuredText')} />
            </p>
            <CodeTabs className="my-0" tabs={getStructuredSnippet(baseUrl, key)} />
          </div>
          <Callout tone="info" title={t('dev.errorsTitle')} className="my-0">
            <RichText text={t('dev.errorsText')} />
          </Callout>
        </DocSection>

        <DocSection
          id="endpoint-models"
          icon={<MethodBadge method="GET" />}
          bareIcon
          monoTitle
          title="/v1/models"
          description={t('dev.navModels')}
        >
          <p className="max-w-[70ch] text-[15px] leading-relaxed text-muted">
            {t('dev.modelsEndpointLead')}
          </p>
          <CodeTabs className="my-0" tabs={getModelsSnippet(baseUrl, key)} />
        </DocSection>
      </div>
    </DocsLayout>
  );
}
