import { Badge } from '@/components/ui/badge';
import type { ToolSolutionDetails } from '@/features/builder/api';
import { useTranslation } from '@/i18n';
import { Page } from '../shared';
import { MaterialsPanel } from './materials-panel';

/**
 * Учебный помощник — инструмент со своей страницей, а не чат. Сейчас — материалы (загрузка,
 * просмотр, удаление); операции над ними (конспект, таблица, вопросы, тест) и прогресс добавляются
 * следующими этапами на этой же странице.
 */
export function StudyAssistantPage({ details }: { details: ToolSolutionDetails }) {
  const { t } = useTranslation();
  const { solution } = details;
  return (
    <Page
      title={solution.name}
      back={{ to: '/solutions', label: t('builder.back') }}
      actions={<Badge>{t('study.badge')}</Badge>}
    >
      <p className="t-lead mt-4">{t('study.lead')}</p>
      <MaterialsPanel solutionId={solution.id} />
    </Page>
  );
}
