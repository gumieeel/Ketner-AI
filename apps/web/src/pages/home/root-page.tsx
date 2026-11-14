import { siteFeatures } from '@/lib/features';
import { productSwitch } from '@/lib/product-switches';
import { LandingPage } from '@/pages/landing-page';
import { HomePage } from './home-page';

/**
 * Главная: при включённой платформе решений — Business Discovery «Расскажите о своём бизнесе», иначе лендинг агрегатора
 * (он же сохранён в ветке archive/home-aggregator-2026-10-30).
 */
export function RootPage() {
  // Чат закрыт (lib/product-switches.ts): лендинг агрегатора не показывается.
  return siteFeatures().discovery || !productSwitch('chat') ? <HomePage /> : <LandingPage />;
}
