import { Link } from 'react-router-dom';
import { LogoutIcon, SparkleIcon } from '@/components/icons';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardText, CardTitle } from '@/components/ui/card';
import { StubAction } from '@/components/ui/stub-action';
import { useTranslation } from '@/i18n';

export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <CardTitle>{t('settings.account')}</CardTitle>
          <CardText className="mt-1">
            {t('settings.guestTitle')}. {t('settings.guestText')}
          </CardText>
        </div>
        <Link to="/login">
          <Button variant="outline">{t('nav.login')}</Button>
        </Link>
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <CardTitle>{t('settings.appearance')}</CardTitle>
          <CardText className="mt-1">{t('settings.appearanceText')}</CardText>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{t('settings.theme')}</span>
          <ThemeToggle />
          <span className="ml-2 text-sm text-zinc-600 dark:text-zinc-300">
            {t('settings.language')}
          </span>
          <LanguageToggle />
        </div>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <CardTitle>{t('settings.subscription')}</CardTitle>
          <CardText className="mt-1">{t('settings.subscriptionText')}</CardText>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="brand">{t('pricing.free')}</Badge>
          <Link to="/pricing">
            <Button variant="outline" size="sm">
              <SparkleIcon className="text-base" />
              {t('nav.upgrade')}
            </Button>
          </Link>
        </div>
      </Card>

      <Card>
        <StubAction label={t('settings.logout')} hint={t('auth.demoNotice')} block>
          <LogoutIcon className="text-lg" />
          {t('settings.logout')}
        </StubAction>
      </Card>
    </div>
  );
}
