import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ProjectList } from '@/components/code/project-list';
import { Workspace } from '@/components/code/workspace';
import { CodeIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
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
  const authRequired = useCode((state) => state.authRequired);

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

  if (authRequired) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
          <CodeIcon className="size-6" />
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-text">{t('code.auth.title')}</h2>
        <p className="text-[14px] leading-6 text-muted">{t('code.auth.hint')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/login" className={buttonClasses({ variant: 'primary', size: 'md' })}>
            {t('nav.login')}
          </Link>
          <Link to="/signup" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
            {t('nav.signup')}
          </Link>
        </div>
      </div>
    );
  }

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
