import { CodeTabs } from '@/components/docs/code-tabs';
import { DocSection } from '@/components/docs/doc-section';
import { MethodBadge } from '@/components/docs/method-badge';
import { ParamTable, type ParamDef } from '@/components/docs/param-table';
import { useTranslation } from '@/i18n';
import { getConversationsSnippets } from './snippets';

export function EndpointConversations({ apiKey }: { apiKey: string }) {
  const { t } = useTranslation();
  const snippets = getConversationsSnippets(apiKey);

  const params: ParamDef[] = [
    { name: 'limit', type: 'integer', default: '20', description: t('apiDocs.paramLimit') },
    { name: 'before', type: 'string', description: t('apiDocs.paramBefore') },
    { name: 'after', type: 'string', description: t('apiDocs.paramAfter') },
  ];

  return (
    <DocSection
      id="endpoint-conversations"
      icon={<MethodBadge method="GET" />}
      title="/v1/conversations"
      bareIcon
      monoTitle
      description="Sessions & History API"
    >
      <p className="text-sm leading-6 text-muted">{t('apiDocs.conversationsLead')}</p>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-text">{t('apiDocs.queryParams')}</h3>
        <ParamTable params={params} className="my-0" />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-text">{t('apiDocs.requestExample')}</h3>
        <CodeTabs tabs={snippets} className="my-0" />
      </div>
    </DocSection>
  );
}
