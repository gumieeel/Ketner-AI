import { Link } from 'react-router-dom';
import {
  CheckIcon,
  SparkleIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-store';
import { PLANS } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import type { Language } from '@/features/preferences/preferences-store';
import { cn } from '@/lib/cn';

/* SVG Icons for Brand Models */
function OpenAiIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.28 9.5a5.98 5.98 0 0 0-.52-4.92 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 10.5 0a6.05 6.05 0 0 0-5.76 4.2 6.07 6.07 0 0 0-4.14 3 6.04 6.04 0 0 0 .75 7.14 5.98 5.98 0 0 0 .52 4.92 6.05 6.05 0 0 0 6.51 2.9A6.07 6.07 0 0 0 13.5 24a6.05 6.05 0 0 0 5.76-4.2 6.07 6.07 0 0 0 4.14-3 6.04 6.04 0 0 0-.75-7.14l-.37-.16zM13.5 22.5a4.5 4.5 0 0 1-2.89-1.05l.14-.08 4.8-2.77a.77.77 0 0 0 .39-.68v-6.77l2.03 1.17a.07.07 0 0 1 .04.05v5.6a4.51 4.51 0 0 1-4.51 4.53zm-9.7-4.13a4.5 4.5 0 0 1-.54-3.02l.14.09 4.8 2.77a.78.78 0 0 0 .78 0l5.86-3.38v2.34a.07.07 0 0 1-.03.06L9.97 20.5a4.51 4.51 0 0 1-6.17-2.13zm-1.26-10.4a4.5 4.5 0 0 1 2.35-1.98v5.7a.77.77 0 0 0 .39.67l5.86 3.38-2.03 1.17a.07.07 0 0 1-.07 0L4.7 13.6a4.51 4.51 0 0 1-2.16-5.63zm16.66 3.87L13.34 8.4l2.03-1.17a.07.07 0 0 1 .07 0l4.33 2.5a4.51 4.51 0 0 1-.7 8.13v-5.7a.77.77 0 0 0-.39-.67zm2.02-3.04-.14-.09-4.8-2.77a.78.78 0 0 0-.78 0L9.74 9.82V7.48a.07.07 0 0 1 .03-.06l4.33-2.5a4.51 4.51 0 0 1 6.18 2.13l-.07.25zM8.7 12.84 6.67 11.67a.07.07 0 0 1-.04-.05V6.03a4.51 4.51 0 0 1 7.4-3.46l-.14.08-4.8 2.77a.77.77 0 0 0-.39.68v6.74zm1.1-2.37 2.61-1.51 2.61 1.5v3.01l-2.61 1.51-2.61-1.5V10.47z" />
    </svg>
  );
}

function ClaudeIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2a1.5 1.5 0 0 0-1.5 1.5v2.2A1.5 1.5 0 0 0 12 7.2a1.5 1.5 0 0 0 1.5-1.5V3.5A1.5 1.5 0 0 0 12 2Zm6.7 3.3a1.5 1.5 0 0 0-2.1.2 1.5 1.5 0 0 0 .2 2.1l1.6 1.3a1.5 1.5 0 0 0 2.1-.2 1.5 1.5 0 0 0-.2-2.1L18.7 5.3Zm-13.4 0-1.6 1.3a1.5 1.5 0 0 0-.2 2.1 1.5 1.5 0 0 0 2.1.2l1.6-1.3a1.5 1.5 0 0 0 .2-2.1 1.5 1.5 0 0 0-2.1-.2ZM2 10.5A1.5 1.5 0 0 0 .5 12 1.5 1.5 0 0 0 2 13.5h2.2A1.5 1.5 0 0 0 5.7 12a1.5 1.5 0 0 0-1.5-1.5H2Zm15.6 0A1.5 1.5 0 0 0 16 12a1.5 1.5 0 0 0 1.5 1.5H20a1.5 1.5 0 0 0 1.5-1.5A1.5 1.5 0 0 0 20 10.5h-2.4Zm-9.4 5.5-1.6 1.3a1.5 1.5 0 0 0-.2 2.1 1.5 1.5 0 0 0 2.1.2l1.6-1.3a1.5 1.5 0 0 0 .2-2.1 1.5 1.5 0 0 0-2.1-.2Zm7.6 0a1.5 1.5 0 0 0-2.1.2 1.5 1.5 0 0 0 .2 2.1l1.6 1.3a1.5 1.5 0 0 0 2.1-.2 1.5 1.5 0 0 0-.2-2.1L15.8 16ZM12 16.8a1.5 1.5 0 0 0-1.5 1.5v2.2A1.5 1.5 0 0 0 12 22a1.5 1.5 0 0 0 1.5-1.5v-2.2A1.5 1.5 0 0 0 12 16.8Z" />
    </svg>
  );
}

function GeminiIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0c.3 6.6 5.4 11.7 12 12-6.6.3-11.7 5.4-12 12-.3-6.6-5.4-11.7-12-12 6.6-.3 11.7-5.4 12-12Z" />
    </svg>
  );
}

function DeepSeekIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M21.5 12c0 4.14-3.58 7.5-8 7.5a9.2 9.2 0 0 1-5.18-1.57C6.1 19.38 3.5 20 2 20c1.2-1.5 1.8-3.1 1.7-4.44A7.28 7.28 0 0 1 2.5 12C2.5 7.86 6.08 4.5 10.5 4.5S18.5 7.86 18.5 12v.5a1 1 0 0 0 1 1 1 1 0 0 0 1-1V12a2 2 0 0 1 1 0zm-11 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3.5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3.5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
    </svg>
  );
}

function QwenIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2 4 6.6v9.8L12 21l8-4.6V6.6L12 2Zm0 3.2 5.5 3.2v6.4L12 18l-5.5-3.2V8.4L12 5.2Zm-2.5 4.5 4.3 2.5-4.3 2.5v-5Z" />
    </svg>
  );
}

function GrokIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

interface TierPlan {
  id: string;
  name: string;
  price: string;
  period: Record<Language, string>;
  speed: Record<Language, string>;
  priority: Record<Language, string>;
  context: Record<Language, string>;
  popular?: boolean;
  popularBadge?: Record<Language, string>;
  buttonText?: Record<Language, string>;
  href: string;
}

export function LandingPage() {
  const { t, language } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);

  // Динамически создаём TIER_PLANS из PLANS
  const TIER_PLANS: TierPlan[] = PLANS.map((plan) => ({
    id: plan.id,
    name: plan.id.charAt(0).toUpperCase() + plan.id.slice(1),
    price: plan.priceMonthly === 0 ? '$0' : `$${plan.priceMonthly}`,
    period: { ru: '/ месяц', en: '/ month' },
    speed:
      plan.id === 'free'
        ? { ru: 'Базовая скорость ответов', en: 'Standard response speed' }
        : plan.id === 'plus'
          ? { ru: 'Быстрая скорость генерации', en: 'Fast response speed' }
          : plan.id === 'pro'
            ? { ru: 'Средняя скорость обработки', en: 'Standard processing speed' }
            : { ru: 'Максимальная скорость обработки', en: 'Maximum processing speed' },
    priority:
      plan.id === 'free'
        ? { ru: 'Стандартная очередь', en: 'Standard queue priority' }
        : plan.id === 'plus'
          ? { ru: 'Повышенный приоритет очереди', en: 'Enhanced queue priority' }
          : plan.id === 'pro'
            ? { ru: 'Высокий приоритет без ожидания', en: 'High priority processing' }
            : { ru: 'Выделенный VIP-приоритет', en: 'Dedicated VIP priority' },
    context:
      plan.id === 'free'
        ? { ru: 'Стандартный контекст диалога', en: 'Standard context window' }
        : { ru: 'Безлимитный контекст диалога', en: 'Unlimited conversation context' },
    popular: plan.popular,
    popularBadge: plan.popular ? { ru: 'Популярный', en: 'Most Popular' } : undefined,
    buttonText:
      plan.id === 'free'
        ? { ru: 'Начать чат', en: 'Start chatting' }
        : plan.id === 'plus'
          ? { ru: 'Выбрать Plus', en: 'Get Plus' }
          : plan.id === 'pro'
            ? { ru: 'Выбрать Pro', en: 'Get Pro' }
            : { ru: 'Выбрать Ultra', en: 'Get Ultra' },
    href: plan.id === 'free' ? '/chat' : `/checkout/${plan.id}`,
  }));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-center gap-24 px-4 py-8 md:px-8 lg:py-12 animate-fade-in text-center selection:bg-emerald-500/20 selection:text-emerald-300">
      {/* 1. HERO SECTION (2 Columns: Hub on Left, Headline & CTA on Right) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center w-full pt-4 md:pt-8">
        
        {/* LEFT COLUMN: THE CIRCULAR HUB & CONNECTED AI MODELS */}
        <div className="relative w-full max-w-[480px] h-[450px] mx-auto flex items-center justify-center">
          {/* Subtle Ambient Radial Backlight */}
          <div className="absolute inset-0 pointer-events-none rounded-full bg-cyan-500/10 blur-3xl" />

          {/* Concentric Decorative Rings */}
          <div className="absolute size-[230px] sm:size-[260px] rounded-full border border-cyan-500/20 pointer-events-none animate-pulse" />
          <div className="absolute size-[350px] sm:size-[390px] rounded-full border border-cyan-500/10 border-dashed pointer-events-none" />

          {/* Connecting SVG Lines */}
          <svg className="absolute inset-0 size-full pointer-events-none opacity-40" viewBox="0 0 480 450">
            <defs>
              <linearGradient id="lineGlow" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
              </linearGradient>
            </defs>
            {/* Center: (240, 225) */}
            <line x1="240" y1="225" x2="240" y2="40" stroke="url(#lineGlow)" strokeWidth="1.5" strokeDasharray="3 3" />
            <line x1="240" y1="225" x2="400" y2="80" stroke="url(#lineGlow)" strokeWidth="1.5" strokeDasharray="3 3" />
            <line x1="240" y1="225" x2="400" y2="370" stroke="url(#lineGlow)" strokeWidth="1.5" strokeDasharray="3 3" />
            <line x1="240" y1="225" x2="240" y2="410" stroke="url(#lineGlow)" strokeWidth="1.5" strokeDasharray="3 3" />
            <line x1="240" y1="225" x2="80" y2="370" stroke="url(#lineGlow)" strokeWidth="1.5" strokeDasharray="3 3" />
            <line x1="240" y1="225" x2="80" y2="80" stroke="url(#lineGlow)" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>

          {/* Central Ketner Hub Circle */}
          <div className="relative z-10 size-28 sm:size-32 rounded-full border-2 border-cyan-400/70 bg-gradient-to-b from-[#0c2331] to-[#061118] p-3 shadow-[0_0_35px_rgba(6,182,212,0.4)] flex fle">
            <img src="/logo-mark.png" alt="Ketner AI" className="size-9 sm:size-10 object-contain drop-shadow-[0_0_12px_rgba(6,182,212,0.8)]" />
            <span className="mt-1.5 text-[10px] sm:text-[11px] font-extrabold tracking-wider text-cyan-300 uppercase">
              Ketner AI
            </span>
          </div>

          {/* 1. TOP: GPT-6 Astra */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 rounded-2xl border border-cyan-500/30 bg-[#0C1520]/95 px-3.5 py-2 shadow-xl backdrop-blur-md hove">
            <div className="grid size-7 place-items-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <OpenAiIcon className="size-4" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">GPT-6</span>
                <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-1.5 py-0.2 text-[9px] font-bold text-cyan-300">
                  Astra
                </span>
              </div>
              <p className="text-[10px] text-slate-400 whitespace-nowrap">Reasoning · Coding</p>
            </div>
          </div>

          {/* 2. TOP RIGHT: Gemini Pro */}
          <div className="absolute top-10 right-0 z-20 flex items-center gap-2.5 rounded-2xl border border-cyan-500/30 bg-[#0C1520]/95 px-3.5 py-2 shadow-xl backdrop-blur-md hover:border-cyan-400">
            <div className="grid size-7 place-items-center rounded-lg bg-blue-500/10 text-blue-400">
              <GeminiIcon className="size-4" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">Gemini</span>
                <span className="rounded-full bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.2 text-[9px] font-bold text-blue-300">
                  Pro
                </span>
              </div>
              <p className="text-[10px] text-slate-400 whitespace-nowrap">Multimodal · Search</p>
            </div>
          </div>

          {/* 3. BOTTOM RIGHT: DeepSeek R1 */}
          <div className="absolute bottom-10 right-0 z-20 flex items-center gap-2.5 rounded-2xl border border-cyan-500/30 bg-[#0C1520]/95 px-3.5 py-2 shadow-xl backdrop-blur-md hover:border-cyan-">
            <div className="grid size-7 place-items-center rounded-lg bg-sky-500/10 text-sky-400">
              <DeepSeekIcon className="size-4" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">DeepSeek</span>
                <span className="rounded-full bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.2 text-[9px] font-bold text-sky-300">
                  R1
                </span>
              </div>
              <p className="text-[10px] text-slate-400 whitespace-nowrap">Reasoning · Coding</p>
            </div>
          </div>

          {/* 4. BOTTOM: Qwen Max */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 rounded-2xl border border-cyan-500/30 bg-[#0C1520]/95 px-3.5 py-2 shadow-xl backdrop-blur-md h">
            <div className="grid size-7 place-items-center rounded-lg bg-purple-500/10 text-purple-400">
              <QwenIcon className="size-4" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">Qwen</span>
                <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.2 text-[9px] font-bold text-purple-300">
                  Max
                </span>
              </div>
              <p className="text-[10px] text-slate-400 whitespace-nowrap">Coding · Open source</p>
            </div>
          </div>

          {/* 5. BOTTOM LEFT: Grok 3 */}
          <div className="absolute bottom-10 left-0 z-20 flex items-center gap-2.5 rounded-2xl border border-cyan-500/30 bg-[#0C1520]/95 px-3.5 py-2 shadow-xl backdrop-blur-md hover:border-cyan-4">
            <div className="grid size-7 place-items-center rounded-lg bg-slate-800 text-slate-200">
              <GrokIcon className="size-4" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">Grok</span>
                <span className="rounded-full bg-slate-700/40 border border-slate-600/40 px-1.5 py-0.2 text-[9px] font-bold text-slate-300">
                  3
                </span>
              </div>
              <p className="text-[10px] text-slate-400 whitespace-nowrap">Reasoning · Real-time</p>
            </div>
          </div>

          {/* 6. TOP LEFT: Claude Opus */}
          <div className="absolute top-10 left-0 z-20 flex items-center gap-2.5 rounded-2xl border border-cyan-500/30 bg-[#0C1520]/95 px-3.5 py-2 shadow-xl backdrop-blur-md hover:border-cyan-400/">
            <div className="grid size-7 place-items-center rounded-lg bg-orange-500/10 text-orange-400">
              <ClaudeIcon className="size-4" />
            </div>
            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-white">Claude</span>
                <span className="rounded-full bg-orange-500/15 border border-orange-500/30 px-1.5 py-0.2 text-[9px] font-bold text-orange-300">
                  Opus
                </span>
              </div>
              <p className="text-[10px] text-slate-400 whitespace-nowrap">Writing · Analysis</p>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: MAIN HEADLINE, SUBTITLE & CALL TO ACTION */}
        <div className="flex flex-col items-start text-left gap-6 justify-center lg:pl-6">
          {/* Small pill badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 shadow-sm">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="tracking-widest uppercase">KETNER AI</span>
          </div>

          {/* Big Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.12]">
            Все AI-модели.<br />
            Один интерфейс.
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-lg text-slate-300/90 max-w-lg leading-relaxed">
            GPT, Claude, Gemini и другие модели — в одном месте.
          </p>

          {status === 'authenticated' && user ? (
            <p className="rounded-full bg-accent/10 px-4 py-1 text-xs font-semibold text-accent border border-accent/20">
              {user.name || user.email} · {user.plan.toUpperCase()}
            </p>
          ) : null}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Link
              to="/chat"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-7 py-3.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 transition-all shadow-lg">
              <span>{t('landing.cta')}</span>
              <span className="text-base font-bold">→</span>
            </Link>
            <Link
              to="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/20 px-6 py-3.5 text-sm font-medium text-emerald-300 hover:bg-emerald-400/10 transition-all">
              <span>{t('landing.viewPlans')}</span>
            </Link>
          </div>

          {/* Micro Benefits Under Buttons */}
          <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <span>⚡</span>
              <span>{language === 'ru' ? 'Без токенов' : 'No tokens'}</span>
            </div>
            <span className="text-slate-600">•</span>
            <div className="flex items-center gap-1.5">
              <span>🔄</span>
              <span>
                {language === 'ru'
                  ? 'Без переключения между сервисами'
                  : 'No switching between services'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. SHOWCASE SECTION (Features on Left, Interactive Chat Window on Right) */}
      <section id="models" className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 items-center w-full pt-16 border-t border-slate-800/60">
        
        {/* LEFT COLUMN: 4 CATEGORIES */}
        <div className="flex flex-col text-left gap-6 justify-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {language === 'ru' ? 'Лучшие модели для любых задач' : 'Top models for any task'}
          </h2>

          <div className="flex flex-col gap-3">
            {/* 1. Тексты и контент */}
            <div className="flex items-center gap-4 rounded-xl p-2.5 transition-colors hover:bg-surface/30">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-lg">
                ⚡
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {language === 'ru' ? 'Тексты и контент' : 'Writing & Content'}
                </h3>
                <p className="text-xs text-slate-400">
                  {language === 'ru'
                    ? 'Письма, статьи, идеи, переводы'
                    : 'Emails, articles, brainstorming, translations'}
                </p>
              </div>
            </div>

            {/* 2. Программирование */}
            <div className="flex items-center gap-4 rounded-xl p-2.5 transition-colors hover:bg-surface/30">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-mono font-bold">
                &lt;/&gt;
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {language === 'ru' ? 'Программирование' : 'Software Engineering'}
                </h3>
                <p className="text-xs text-slate-400">
                  {language === 'ru'
                    ? 'Код, отладка, архитектура'
                    : 'Code generation, debugging, system architecture'}
                </p>
              </div>
            </div>

            {/* 3. Изображения */}
            <div className="flex items-center gap-4 rounded-xl p-2.5 transition-colors hover:bg-surface/30">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-lg">
                🖼
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {language === 'ru' ? 'Изображения' : 'Image Generation'}
                </h3>
                <p className="text-xs text-slate-400">
                  {language === 'ru'
                    ? 'Генерация и редактирование'
                    : 'Visual generation and creative editing'}
                </p>
              </div>
            </div>

            {/* 4. Анализ и исследования */}
            <div className="flex items-center gap-4 rounded-xl p-2.5 transition-colors hover:bg-surface/30">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-lg">
                📈
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {language === 'ru' ? 'Анализ и исследования' : 'Analysis & Research'}
                </h3>
                <p className="text-xs text-slate-400">
                  {language === 'ru'
                    ? 'Данные, документы, сложные задачи'
                    : 'Data synthesis, deep research, document analysis'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: REALISTIC MOCK CHAT WINDOW */}
        <div className="w-full rounded-2xl border border-slate-700/50 bg-[#0C1520]/95 shadow-2xl backdrop-blur-md overflow-hidden flex flex-col text-left">
          {/* Window Titlebar */}
          <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#091018]/80 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-red-500/80" />
                <span className="size-2.5 rounded-full bg-amber-500/80" />
                <span className="size-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <div className="ml-2 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <img src="/logo-mark.png" alt="Ketner" className="size-3.5 object-contain" />
                <span>Ketner AI</span>
              </div>
            </div>
          </div>

          {/* Window Body: Sidebar + Chat Area */}
          <div className="grid grid-cols-1 sm:grid-cols-[165px_1fr] min-h-[340px]">
            {/* Left Model Sidebar */}
            <div className="border-r border-slate-800/60 bg-[#080E16]/60 p-2 flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1.5 text-white font-medium">
                <OpenAiIcon className="size-3.5 text-emerald-400" />
                <span>GPT-6 Astra</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-400 hover:text-slate-200 transition-colors">
                <ClaudeIcon className="size-3.5 text-orange-400" />
                <span>Claude Opus</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-400 hover:text-slate-200 transition-colors">
                <GeminiIcon className="size-3.5 text-blue-400" />
                <span>Gemini Pro</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-400 hover:text-slate-200 transition-colors">
                <GrokIcon className="size-3.5 text-slate-300" />
                <span>Grok 3</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-400 hover:text-slate-200 transition-colors">
                <QwenIcon className="size-3.5 text-purple-400" />
                <span>Qwen Max</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-slate-400 hover:text-slate-200 transition-colors">
                <DeepSeekIcon className="size-3.5 text-sky-400" />
                <span>DeepSeek R1</span>
              </div>
            </div>

            {/* Right Chat View */}
            <div className="p-4 flex flex-col justify-between gap-4 bg-[#0A121A]/70">
              <div className="flex flex-col gap-3">
                {/* User Message */}
                <div className="flex items-start gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-300">
                    {language === 'ru' ? 'Вы' : 'You'}
                  </span>
                  <div className="rounded-xl bg-[#142232] px-3.5 py-2 text-xs text-slate-200 border border-slate-700/40 leading-relaxed">
                    {language === 'ru'
                      ? 'Объясни разницу между квантовыми и классическими вычислениями в 2 предложениях.'
                      : 'Explain the difference between quantum and classical computing in 2 sentences.'}
                  </div>
                </div>

                {/* AI Response */}
                <div className="flex items-start gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <OpenAiIcon className="size-3.5 text-emerald-400" />
                  </span>
                  <div className="flex flex-col gap-1.5 rounded-xl bg-[#121E2C] p-3 text-xs text-slate-200 border border-slate-700/40 leading-relaxed flex-1">
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                      <span>✨</span>
                      <span>GPT-6 Astra</span>
                    </div>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      {language === 'ru'
                        ? 'Классические компьютеры обрабатывают данные последовательно с помощью бинарных битов (0 или 1). Квантовые компьютеры используют кубиты и суперпозицию для одновременной обработки множества состояний.'
                        : 'Classical computers process data sequentially using binary bits (0 or 1). Quantum computers utilize qubits and superposition to evaluate multiple states simultaneously.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Chat Input Bar */}
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#0D1722] border border-slate-700/50 px-3 py-2 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">📎</span>
                  <span className="text-slate-500">
                    {language === 'ru' ? 'Напишите сообщение...' : 'Type a message...'}
                  </span>
                </div>
                <Link
                  to="/chat"
                  className="grid size-6 place-items-center rounded-lg bg-emerald-400/20 text-emerald-400 hover:bg-emerald-400/30 transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. PRICING SECTION */}
      <section className="flex w-full flex-col items-center gap-8 pt-12 border-t border-slate-800/60">
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {t('landing.pricingTitle')}
          </h2>
          <p className="text-sm text-slate-400 max-w-md text-balance">
            {t('landing.pricingSubtitle')}
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-left">
          {TIER_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                'flex flex-col justify-between rounded-2xl p-5 border transition-all',
                plan.popular
                  ? 'border-emerald-500 bg-emerald-500/10 shadow-lg relative'
                  : 'border-slate-800 bg-[#0C1520]/80 hover:border-slate-700',
              )}
            >
              {plan.popular && (
                <div className="absolute -top-2.5 right-4 rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-bold text-slate-950 uppercase tracking-wide">
                  {plan.popularBadge ? plan.popularBadge[language] : (language === 'ru' ? 'Популярный' : 'Most Popular')}
                </div>
              )}

              <div>
                <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                  <span className="text-xs text-slate-400">{plan.period[language]}</span>
                </div>

                <div className="mt-5 flex flex-col gap-2.5 border-t border-slate-800/80 pt-4 text-xs">
                  <div className="flex items-start gap-2">
                    <CheckIcon className="size-4 shrink-0 text-emerald-400 mt-0.5" />
                    <span className="text-slate-300 font-medium">{plan.speed[language]}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckIcon className="size-4 shrink-0 text-emerald-400 mt-0.5" />
                    <span className="text-slate-300 font-medium">{plan.priority[language]}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckIcon className="size-4 shrink-0 text-emerald-400 mt-0.5" />
                    <span className="text-slate-300 font-medium">{plan.context[language]}</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-2">
                <Link to={plan.href} className="w-full block">
                  <Button
                    variant={plan.popular ? 'primary' : 'outline'}
                    size="md"
                    className="w-full font-semibold text-xs"
                  >
                    {plan.buttonText ? plan.buttonText[language] : (plan.id === 'free' ? t('landing.cta') : `Get ${plan.name}`)}
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. FINAL CALL TO ACTION */}
      <section className="flex w-full flex-col items-center gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 md:p-12">
        <SparkleIcon className="text-3xl text-emerald-400" />
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
          {t('landing.heroTitle')}
        </h2>
        <p className="text-sm text-slate-400 max-w-md">
          {t('landing.heroSubtitle')} · {t('landing.heroNote')}
        </p>
        <Link to="/chat" className="mt-2">
          <Button size="lg" className="px-8 font-semibold shadow-lg shadow-emerald-500/25">
            {t('landing.cta')}
          </Button>
        </Link>
      </section>
    </div>
  );
}
