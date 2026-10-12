import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, LockIcon, ShieldIcon, TerminalIcon } from '@/components/icons';
import { DocSection } from '@/components/docs/doc-section';
import { RichText } from '@/components/ui/rich-text';
import { useTranslation } from '@/i18n';

function SecurityCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-stroke bg-canvas p-4">
      <h3 className="flex items-start gap-2 text-sm font-semibold text-text">
        <span className="mt-0.5 shrink-0 text-accent">{icon}</span>
        {title}
      </h3>
      <div className="text-[13px] leading-6 text-muted">{children}</div>
    </div>
  );
}

export function SecuritySection() {
  const { t } = useTranslation();

  return (
    <DocSection
      id="security"
      icon={<ShieldIcon className="size-5" />}
      title={t('apiDocs.secTitle')}
      description={t('apiDocs.secDesc')}
    >
      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 md:gap-4">
        <SecurityCard icon={<CheckIcon className="size-4" />} title={t('apiDocs.secConfirmTitle')}>
          <RichText text={t('apiDocs.secConfirmText')} />
        </SecurityCard>

        <SecurityCard icon={<LockIcon className="size-4" />} title={t('apiDocs.secSecretsTitle')}>
          <RichText text={t('apiDocs.secSecretsText')} />
        </SecurityCard>

        <SecurityCard icon={<TerminalIcon className="size-4" />} title={t('apiDocs.secDockerTitle')}>
          {t('apiDocs.secDockerText')}
          <code tabIndex={0} className="mt-2 block overflow-x-auto rounded-lg border border-stroke bg-surface p-2.5 font-mono text-xs whitespace-nowrap text-accent">
            docker run -v $(pwd):/workspace ketner/agent:latest
          </code>
        </SecurityCard>

        <SecurityCard icon={<AlertIcon className="size-4" />} title={t('apiDocs.secBlacklistTitle')}>
          {t('apiDocs.secBlacklistText')}
        </SecurityCard>
      </div>
    </DocSection>
  );
}
