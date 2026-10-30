import { siteFeatures } from './features';

/**
 * Куда ведут ссылки на разделы о моделях, возможностях и вопросах. На лендинге агрегатора они
 * лежат на главной; при включённой платформе решений эти разделы переехали на /models и /pricing.
 */
export function sectionLinks(): { spaces: string; models: string; faq: string } {
  return siteFeatures().discovery
    ? { spaces: '/models#spaces', models: '/models', faq: '/pricing#faq' }
    : { spaces: '/#spaces', models: '/#models', faq: '/#faq' };
}
