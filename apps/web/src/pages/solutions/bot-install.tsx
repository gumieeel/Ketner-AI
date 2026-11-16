import { useId, useMemo, useState } from 'react';
import { buttonClasses } from '@/components/ui/button-classes';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { QrCode } from '@/components/ui/qr-code';
import type { BotOverview } from '@/features/builder/api';
import {
  INSTALL_GUIDES,
  developerMailto,
  developerMessage,
  embedCode,
  type SiteBuilderId,
} from '@/features/builder/install-guides';
import { useTranslation } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { qrPngBlob, qrSvgMarkup } from '@/lib/qr';

/**
 * Простое развёртывание бота (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 10, P10): сначала ссылка
 * и QR — у многих клиентов сайта нет; затем код для сайта с шагами под конструктор, письмо
 * разработчику и проверка, что виджет установлен.
 */

/** Ссылка на страницу бота и QR-код с загрузкой для печати. */
export function BotLinkAndQr({ overview }: { overview: BotOverview }) {
  const { t } = useTranslation();
  const slug = overview.settings.slug;
  const svgHref = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvgMarkup(overview.publicUrl))}`,
    [overview.publicUrl],
  );
  const downloadPng = async () => {
    const blob = await qrPngBlob(overview.publicUrl);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ketner-bot-${slug}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-5 grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-text">{t('builder.bot.share.link')}</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-stroke bg-surface px-3 py-2 text-[14px] text-text">
            {overview.publicUrl}
          </code>
          <CopyButton value={overview.publicUrl} label={t('builder.bot.share.copyLink')} />
        </div>
      </div>
      <figure className="flex flex-col items-start gap-2 sm:items-center">
        <QrCode value={overview.publicUrl} size={144} />
        <figcaption className="max-w-[12rem] text-[13px] leading-5 text-subtle sm:text-center">
          {t('builder.bot.share.qr')}
        </figcaption>
        <div className="flex flex-wrap gap-2 sm:justify-center">
          <Button variant="outline" size="sm" onClick={() => void downloadPng()}>
            {t('builder.bot.share.downloadPng')}
          </Button>
          <a
            href={svgHref}
            download={`ketner-bot-${slug}.svg`}
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            {t('builder.bot.share.downloadSvg')}
          </a>
        </div>
      </figure>
    </div>
  );
}

/** Код для сайта, шаги под конструктор, письмо разработчику и проверка установки. */
export function BotSiteInstall({
  overview,
  onCheck,
}: {
  overview: BotOverview;
  onCheck: () => Promise<void>;
}) {
  const { t, language } = useTranslation();
  const selectId = useId();
  const [builder, setBuilder] = useState<SiteBuilderId>('tilda');
  const [checking, setChecking] = useState(false);
  const embed = embedCode(overview);
  const guide = INSTALL_GUIDES.find((item) => item.id === builder) ?? INSTALL_GUIDES[0]!;
  const message = developerMessage(language, embed, overview.publicUrl);
  const sites = overview.install?.sites ?? [];

  const check = async () => {
    setChecking(true);
    try {
      await onCheck();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="mt-8">
      <h3 className="text-[16px] font-medium text-text">{t('builder.bot.install.title')}</h3>
      <p className="mt-1 text-[14px] leading-6 text-muted">{t('builder.bot.install.lead')}</p>

      <p className="mt-4 text-[14px] font-medium text-text">{t('builder.bot.share.embed')}</p>
      <p className="mt-1 text-[13px] leading-5 text-subtle">{t('builder.bot.share.embedHint')}</p>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-lg border border-stroke bg-surface px-3 py-2 font-mono text-[13px] leading-5 break-all text-text">
          {embed}
        </code>
        <CopyButton value={embed} label={t('builder.bot.share.copyEmbed')} />
      </div>

      <label htmlFor={selectId} className="mt-5 block text-[14px] font-medium text-text">
        {t('builder.bot.install.builder')}
      </label>
      <select
        id={selectId}
        value={builder}
        onChange={(event) => setBuilder(event.target.value as SiteBuilderId)}
        className="mt-2 h-11 w-full max-w-xs rounded-xl border border-stroke bg-surface px-3 text-[16px] text-text focus:border-stroke-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {INSTALL_GUIDES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name[language]}
          </option>
        ))}
      </select>
      {guide.method === 'link' ? (
        <p className="mt-3 text-[14px] leading-6 text-muted">
          {t('builder.bot.install.linkMethod')}
        </p>
      ) : null}
      <ol
        aria-label={guide.name[language]}
        className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-6 text-text"
      >
        {guide.steps[language].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className="mt-6 rounded-xl border border-stroke bg-surface px-4 py-4">
        <p className="text-[14px] font-medium text-text">{t('builder.bot.install.developer')}</p>
        <p className="mt-1 text-[13px] leading-5 text-subtle">
          {t('builder.bot.install.developerHint')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={developerMailto(message)}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            {t('builder.bot.install.email')}
          </a>
          <CopyButton value={message.body} label={t('builder.bot.install.copyText')} size="sm" />
        </div>
      </div>

      <div className="mt-6" aria-live="polite">
        <p className="text-[14px] font-medium text-text">{t('builder.bot.install.statusTitle')}</p>
        {sites.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5 text-[14px] leading-6 text-text">
            {sites.map((site) => (
              <li key={site.origin}>
                {t('builder.bot.install.found', { site: site.origin.replace(/^https?:\/\//, '') })}
                <span className="text-subtle">
                  {' · '}
                  {t('builder.bot.install.lastSeen', {
                    time: formatDateTime(site.lastSeenAt, language),
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] leading-6 text-muted">
            {t('builder.bot.install.notFound')}
          </p>
        )}
        <p className="mt-2 text-[13px] leading-5 text-subtle">{t('builder.bot.install.hint')}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={checking}
          onClick={() => void check()}
        >
          {t('builder.bot.install.check')}
        </Button>
      </div>
    </div>
  );
}
