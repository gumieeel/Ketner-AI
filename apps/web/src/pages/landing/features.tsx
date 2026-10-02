import { EditIcon, CodeIcon, ImageIcon, ChartIcon } from '@/components/icons';
import { ChatMock } from '@/components/marketing/chat-mock';
import { Section } from '@/components/marketing/section';
import { Card, CardTitle, CardText } from '@/components/ui/card';
import { useTranslation } from '@/i18n';

export function LandingFeatures() {
  const { language } = useTranslation();

  return (
    <Section
      id="features"
      index="02"
      label={language === 'ru' ? 'Возможности' : 'Features'}
      title={
        language === 'ru'
          ? 'Лучшие модели для любых задач'
          : 'Top models for any task'
      }
      description={
        language === 'ru'
          ? 'Работайте с текстом, кодом, визуалом и глубокими исследованиями в едином окружении.'
          : 'Work with writing, code, graphics, and deep analytical research in a unified environment.'
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-4 items-stretch">
        {/* Large Mock Chat Window (4 columns) */}
        <div className="md:col-span-4 flex flex-col">
          <ChatMock className="h-full" />
        </div>

        {/* 2 Right Column Cards (2 columns) */}
        <div className="md:col-span-2 flex flex-col gap-4">
          {/* 1. Тексты и контент */}
          <Card variant="interactive" corners className="flex flex-row sm:flex-col gap-3.5 sm:gap-3 p-4 sm:p-5 h-auto sm:h-full items-start text-left">
            <div className="grid size-[40px] shrink-0 place-items-center rounded-md bg-surface-2 text-accent">
              <EditIcon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                {language === 'ru' ? 'Тексты и контент' : 'Writing & Content'}
              </CardTitle>
              <CardText className="mt-1 text-sm text-muted">
                {language === 'ru'
                  ? 'Письма, статьи, идеи, переводы'
                  : 'Emails, articles, brainstorming, translations'}
              </CardText>
            </div>
          </Card>

          {/* 2. Программирование */}
          <Card variant="interactive" corners className="flex flex-row sm:flex-col gap-3.5 sm:gap-3 p-4 sm:p-5 h-auto sm:h-full items-start text-left">
            <div className="grid size-[40px] shrink-0 place-items-center rounded-md bg-surface-2 text-accent">
              <CodeIcon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                {language === 'ru' ? 'Программирование' : 'Software Engineering'}
              </CardTitle>
              <CardText className="mt-1 text-sm text-muted">
                {language === 'ru'
                  ? 'Код, отладка, архитектура'
                  : 'Code generation, debugging, system architecture'}
              </CardText>
            </div>
          </Card>
        </div>

        {/* 3. Изображения (3 columns) */}
        <div className="md:col-span-3">
          <Card variant="interactive" corners className="flex flex-row sm:flex-col gap-3.5 sm:gap-3 p-4 sm:p-5 h-auto sm:h-full items-start text-left">
            <div className="grid size-[40px] shrink-0 place-items-center rounded-md bg-surface-2 text-accent">
              <ImageIcon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                {language === 'ru' ? 'Изображения' : 'Image Generation'}
              </CardTitle>
              <CardText className="mt-1 text-sm text-muted">
                {language === 'ru'
                  ? 'Генерация и редактирование'
                  : 'Visual generation and creative editing'}
              </CardText>
            </div>
          </Card>
        </div>

        {/* 4. Анализ и исследования (3 columns) */}
        <div className="md:col-span-3">
          <Card variant="interactive" corners className="flex flex-row sm:flex-col gap-3.5 sm:gap-3 p-4 sm:p-5 h-auto sm:h-full items-start text-left">
            <div className="grid size-[40px] shrink-0 place-items-center rounded-md bg-surface-2 text-accent">
              <ChartIcon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                {language === 'ru' ? 'Анализ и исследования' : 'Analysis & Research'}
              </CardTitle>
              <CardText className="mt-1 text-sm text-muted">
                {language === 'ru'
                  ? 'Данные, документы, сложные задачи'
                  : 'Data synthesis, deep research, document analysis'}
              </CardText>
            </div>
          </Card>
        </div>
      </div>
    </Section>
  );
}
