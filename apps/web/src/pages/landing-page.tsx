import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';

export function LandingPage() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  return (
    <div className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 px-4 py-16 text-center animate-fade-in bg-ambient-mesh">
      <div className="relative">
        <div className="absolute -inset-4 rounded-full bg-accent/15 blur-xl animate-pulse pointer-events-none" />
        <img
          src="/logo-mark.png"
          alt="Ketner AI"
          className="relative size-24 object-contain drop-shadow-xl md:size-28 animate-float"
        />
      </div>

      <div className="flex flex-col items-center gap-3 animate-slide-up">
        <div className="inline-flex items-center gap-2 rounded-full border border-stroke/20 bg-surface/80 px-3.5 py-1 text-xs font-medium text-muted backdrop-blur-sm">
          <span className="size-2 rounded-full bg-accent animate-ping" />
          <span>Новые модели: GPT-6 Astra · Claude 4.5 · Gemini 3.8</span>
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl lg:text-6xl text-text">
          {t('landing.title')}
        </h1>
        <p className="max-w-xl text-base md:text-lg text-muted leading-relaxed">
          {t('landing.subtitle')}
        </p>

        {status === 'authenticated' && user ? (
          <p className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            Вы вошли как {user.name || user.email}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Link to="/chat">
          <Button size="lg" className="shadow-lg shadow-accent/20">
            {t('landing.cta')}
          </Button>
        </Link>
        <Link to="/pricing">
          <Button size="lg" variant="outline">
            {t('nav.pricing')}
          </Button>
        </Link>
        {status !== 'authenticated' ? (
          <Link to="/login">
            <Button size="lg" variant="ghost">
              {t('nav.login')}
            </Button>
          </Link>
        ) : (
          <Link to="/settings">
            <Button size="lg" variant="ghost">
              {t('nav.settings')}
            </Button>
          </Link>
        )}
      </div>

      {/* Интерактивные карточки-тизеры возможностей */}
      <div className="mt-8 grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
        <div className="card-interactive rounded-xl border border-stroke/20 bg-surface/70 p-4 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-text">🧠 Мультимодельный хаб</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Переключайтесь между GPT-6 Astra, Claude 4.5 Sonnet и Gemini 3.8 Pro прямо в диалоге.
          </p>
        </div>
        <div className="card-interactive rounded-xl border border-stroke/20 bg-surface/70 p-4 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-text">⚡ Умные лимиты</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            5-часовые скользящие лимиты без жестких блокировок или бесконечный кодинг в тарифе
            Ultra.
          </p>
        </div>
        <div className="card-interactive rounded-xl border border-stroke/20 bg-surface/70 p-4 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-text">📚 Открытая документация</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Прозрачные спецификации моделей, бенчмарки и архитектура скользящих окон.
          </p>
        </div>
      </div>
    </div>
  );
}
