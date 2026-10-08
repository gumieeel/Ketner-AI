import { CodeTabs } from '@/components/docs/code-tabs';
import { DocSection } from '@/components/docs/doc-section';
import { MethodBadge } from '@/components/docs/method-badge';
import { ParamTable, type ParamDef } from '@/components/docs/param-table';
import { useTranslation } from '@/i18n';
import { getCompletionsSnippets } from './snippets';

export function EndpointCompletions({ apiKey }: { apiKey: string }) {
  const { t } = useTranslation();
  const snippets = getCompletionsSnippets(apiKey);

  const params: ParamDef[] = [
    { name: 'model', type: 'string', required: true, description: t('apiDocs.paramModel') },
    { name: 'messages', type: 'array', required: true, description: t('apiDocs.paramMessages') },
    { name: 'stream', type: 'boolean', default: 'false', description: t('apiDocs.paramStream') },
    { name: 'temperature', type: 'number', default: '0.7', description: t('apiDocs.paramTemperature') },
    { name: 'max_tokens', type: 'integer', description: t('apiDocs.paramMaxTokens') },
  ];

  return (
    <DocSection
      id="endpoint-completions"
      icon={<MethodBadge method="POST" />}
      title="/v1/chat/completions"
      bareIcon
      monoTitle
      description="OpenAI Chat Completion API"
    >
      <p className="text-sm leading-6 text-muted">{t('apiDocs.completionsLead')}</p>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-text">{t('apiDocs.bodyParams')}</h3>
        <ParamTable params={params} className="my-0" />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-text">{t('apiDocs.callExamples')}</h3>
        <CodeTabs tabs={snippets} className="my-0" />
      </div>
    </DocSection>
  );
}
