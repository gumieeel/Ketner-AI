import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { ToolSolutionDetails } from '@/features/builder/api';
import { useTranslation } from '@/i18n';
import { Page } from '../shared';
import { CreatePanel } from './create-panel';
import { MaterialsPanel } from './materials-panel';
import { ProgressPanel } from './progress-panel';
import { RunsPanel } from './runs-panel';

/**
 * Учебный помощник — инструмент со своей страницей, а не чат: материалы, создание конспекта или
 * таблицы, теста или самопроверки с ценой до запуска, история результатов и прогресс по темам.
 */
export function StudyAssistantPage({ details }: { details: ToolSolutionDetails }) {
  const { t } = useTranslation();
  const { solution, config } = details;
  const [materialsVersion, setMaterialsVersion] = useState(0);
  return (
    <Page
      title={solution.name}
      back={{ to: '/solutions', label: t('builder.back') }}
      actions={<Badge>{t('study.badge')}</Badge>}
    >
      <p className="t-lead mt-4">{t('study.lead')}</p>
      <MaterialsPanel
        solutionId={solution.id}
        onChange={() => setMaterialsVersion((value) => value + 1)}
      />
      <CreatePanel
        solutionId={solution.id}
        defaultSubject={config.subject}
        materialsVersion={materialsVersion}
      />
      <RunsPanel solutionId={solution.id} />
      <ProgressPanel solutionId={solution.id} />
    </Page>
  );
}
