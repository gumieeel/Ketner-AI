import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ProjectList } from '@/components/code/project-list';
import { Workspace } from '@/components/code/workspace';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useCode } from '@/features/code/code-store';
import { useTranslation } from '@/i18n';

/** `/code` — список проектов, `/code/:projectId` — рабочее пространство. */
export function CodePage() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const loadCapabilities = useCode((state) => state.loadCapabilities);
  const loadProjects = useCode((state) => state.loadProjects);
  const openProject = useCode((state) => state.openProject);
  const closeProject = useCode((state) => state.closeProject);
  const projectStatus = useCode((state) => state.projectStatus);
  const notice = useCode((state) => state.notice);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  useEffect(() => {
    if (!projectId) {
      closeProject();
      void loadProjects();
      return;
    }
    void openProject(projectId);
  }, [projectId, loadProjects, openProject, closeProject]);

  useEffect(() => () => closeProject(), [closeProject]);

  if (!projectId) {
    return (
      <div className="h-full overflow-y-auto">
        <ProjectList />
      </div>
    );
  }

  if (projectStatus === 'error') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <p role="alert" className="text-sm text-danger">
          {t('code.ws.projectError')}
          {notice?.kind === 'message' ? `: ${notice.text}` : ''}
        </p>
        <Button variant="outline" onClick={() => void openProject(projectId)}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (projectStatus !== 'ready') {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6 text-accent" />
      </div>
    );
  }

  return <Workspace />;
}
