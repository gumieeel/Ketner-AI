import { useEffect, useRef, useState } from 'react';
import { SendIcon, SparkleIcon } from '@/components/icons';
import { DocSection } from '@/components/docs/doc-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n';

const SELECT_CLASS =
  'h-12 w-full rounded-md border border-stroke bg-surface px-3 text-base text-text shadow-xs transition-[border-color,box-shadow] hover:border-stroke-strong focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none md:h-11 md:text-[15px]';

export function PlaygroundSection() {
  const { t } = useTranslation();
  const [testModel, setTestModel] = useState('gpt-6.1-sol');
  const [testPrompt, setTestPrompt] = useState(() => t('apiDocs.playPromptDefault'));
  const [testResponse, setTestResponse] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Потоковая «печать» не должна продолжаться после ухода со страницы.
  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current);
    },
    [],
  );

  const handleRunTest = () => {
    if (timer.current !== null) clearInterval(timer.current);
    setTestLoading(true);
    setTestResponse('');
    const fullText = t('apiDocs.playResponse', { model: testModel });

    let i = 0;
    timer.current = setInterval(() => {
      i += 12;
      setTestResponse(fullText.slice(0, i));
      if (i >= fullText.length) {
        if (timer.current !== null) clearInterval(timer.current);
        timer.current = null;
        setTestLoading(false);
      }
    }, 25);
  };

  return (
    <DocSection
      id="playground"
      icon={<SparkleIcon className="size-5" />}
      title={t('apiDocs.playTitle')}
      description={t('apiDocs.playDesc')}
      aside={<code className="font-mono text-xs text-muted">POST /v1/chat/completions</code>}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <label htmlFor="playground-model" className="mb-1.5 block text-[13px] font-medium text-text">
            {t('apiDocs.playModel')}
          </label>
          <select
            id="playground-model"
            value={testModel}
            onChange={(e) => setTestModel(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="gpt-6.1-sol">{t('apiDocs.playModelGpt')}</option>
            <option value="claude-opus-5.5">{t('apiDocs.playModelClaude')}</option>
            <option value="gemini-3.8-flash">{t('apiDocs.playModelGemini')}</option>
            <option value="ketner-mini">{t('apiDocs.playModelMini')}</option>
          </select>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="playground-prompt" className="mb-1.5 block text-[13px] font-medium text-text">
              {t('apiDocs.playPrompt')}
            </label>
            <Input
              id="playground-prompt"
              type="text"
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            size="md"
            loading={testLoading}
            leftIcon={<SendIcon className="size-4" />}
            onClick={handleRunTest}
            className="shrink-0 gap-1.5 max-sm:w-full md:h-11"
          >
            {testLoading ? t('apiDocs.playRunning') : t('apiDocs.playRun')}
          </Button>
        </div>
      </div>

      {testResponse !== null ? (
        <pre
          aria-live="polite"
          className="animate-fade-in overflow-x-auto rounded-xl border border-stroke bg-canvas p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap text-text"
        >
          {testResponse}
          {testLoading ? <span className="ml-1 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" /> : null}
        </pre>
      ) : null}
    </DocSection>
  );
}
