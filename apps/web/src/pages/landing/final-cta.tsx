import { Link } from 'react-router-dom';
import { ArrowRightIcon, SparkleIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CornerMark } from '@/components/ui/corner-mark';
import { Reveal } from '@/components/ui/reveal';
import { useTranslation } from '@/i18n';

export function LandingFinalCta() {
  const { language } = useTranslation();

  return (
    <div className="w-full my-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-lg border border-stroke bg-canvas py-16 md:py-24 px-6 md:px-12 text-center bg-dots">
          {/* Corner marks */}
          <CornerMark size={12} className="absolute top-2 left-2 text-stroke-strong" />
          <CornerMark size={12} className="absolute top-2 right-2 text-stroke-strong rotate-90" />
          <CornerMark size={12} className="absolute bottom-2 right-2 text-stroke-strong rotate-180" />
          <CornerMark size={12} className="absolute bottom-2 left-2 text-stroke-strong -rotate-90" />

          <div className="relative z-10 flex flex-col items-center max-w-[620px] mx-auto gap-6">
            <div className="grid size-12 place-items-center rounded-md border border-stroke bg-surface-2 text-accent shadow-sm">
              <SparkleIcon className="size-6" />
            </div>

            <h2 className="text-3xl md:text-5xl font-semibold tracking-[-0.03em] text-text text-balance">
              {language === 'ru'
                ? 'Начните работу с лучшим AI уже сегодня'
                : 'Start working with the best AI today'}
            </h2>

            <p className="text-base text-muted max-w-[48ch] leading-relaxed">
              {language === 'ru'
                ? 'Все флагманские модели нейросетей собраны в одном быстром и интуитивном рабочем пространстве.'
                : 'All flagship AI models unified in one fast, sleek, and intuitive workspace.'}
            </p>

            <div className="pt-2">
              <Link to="/chat">
                <Button size="lg" variant="primary" rightIcon={<ArrowRightIcon className="text-base" />}>
                  {language === 'ru' ? 'Начать чат' : 'Start chatting'}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
