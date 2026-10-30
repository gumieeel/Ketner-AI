import { siteFeatures } from '@/lib/features';
import { LandingPage } from '@/pages/landing-page';
import { HomePage } from './home-page';

/**
 * Главная: при включённой платформе решений — «Что вы хотите улучшить?», иначе лендинг агрегатора
 * (он же сохранён в ветке archive/home-aggregator-2026-10-30).
 */
export function RootPage() {
  return siteFeatures().discovery ? <HomePage /> : <LandingPage />;
}
