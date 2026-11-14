import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { StandaloneLayout } from '@/components/layout/standalone-layout';
import { RootPage } from '@/pages/home/root-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { ClosedFeaturePage, FeatureGate } from '@/pages/closed-feature-page';
import { productSwitch, type ProductFeature } from '@/lib/product-switches';
import { PricingPage } from '@/pages/pricing-page';
import { RouteErrorPage } from '@/pages/route-error-page';
import { SignupPage } from '@/pages/signup-page';
import type { LegalPageId } from '@/features/content/legal';

/**
 * Ленивая загрузка страницы: код рабочих разделов (чат, Code, изображения, админка, оплата…)
 * не попадает в первый бандл лендинга. Роутер дожидается чанка, показывая текущую страницу,
 * а сбой загрузки (например, после деплоя) уходит в errorElement маршрута.
 */
function lazyPage<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
): RouteObject['lazy'] {
  return async () => ({ Component: (await load())[name] });
}

/** Правовые страницы делят один модуль, различаются только документом. */
function lazyLegal(id: LegalPageId): RouteObject['lazy'] {
  return async () => {
    const { LegalPage } = await import('@/pages/legal-page');
    return { Component: () => <LegalPage id={id} /> };
  };
}

/**
 * Страница закрытой возможности (lib/product-switches.ts): проверка при отрисовке, а не при загрузке
 * маршрута, — тесты спящего кода включают возможность после того, как маршруты уже загружены.
 */
function gatedLazy<K extends string>(
  feature: ProductFeature,
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
): RouteObject['lazy'] {
  return async () => {
    const Page: ComponentType = (await load())[name];
    return {
      Component: () =>
        productSwitch(feature) ? <Page /> : <ClosedFeaturePage feature={feature} />,
    };
  };
}

const chatPage = lazyPage(() => import('@/pages/chat-page'), 'ChatPage');
const codePage = lazyPage(() => import('@/pages/code-page'), 'CodePage');
const apiDocsPage = lazyPage(() => import('@/pages/api-docs-page'), 'ApiDocsPage');
const gatedDocumentationPage = gatedLazy(
  'chat',
  () => import('@/pages/documentation-page'),
  'DocumentationPage',
);

/**
 * Маршруты приложения.
 *
 * Разделены на три группы: маркетинговые и служебные страницы (StandaloneLayout),
 * рабочая область чата и настроек (AppShell) и 404. Полная карта — docs/screens.md.
 */
export const routes: RouteObject[] = [
  {
    element: <StandaloneLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <RootPage /> },
      {
        path: 'analyses',
        lazy: lazyPage(() => import('@/pages/analysis/analyses-list-page'), 'AnalysesListPage'),
      },
      {
        path: 'solutions',
        lazy: lazyPage(() => import('@/pages/solutions/solutions-list-page'), 'SolutionsListPage'),
      },
      {
        path: 'solutions/:solutionId',
        lazy: lazyPage(() => import('@/pages/solutions/solution-page'), 'SolutionPage'),
      },
      {
        path: 'solutions/:solutionId/runs/:runId',
        lazy: lazyPage(() => import('@/pages/solutions/study/run-page'), 'RunPage'),
      },
      {
        path: 'solutions/:solutionId/attempts/:attemptId',
        lazy: lazyPage(() => import('@/pages/solutions/study/attempt-views'), 'AttemptPage'),
      },
      {
        path: 'solutions/:solutionId/chat',
        lazy: lazyPage(() => import('@/pages/solutions/solution-chat-page'), 'SolutionChatPage'),
      },
      {
        path: 'requests',
        lazy: lazyPage(() => import('@/pages/requests/requests-page'), 'RequestsPage'),
      },
      {
        path: 'requests/:requestId',
        lazy: lazyPage(() => import('@/pages/requests/requests-page'), 'RequestPage'),
      },
      {
        path: 'analyses/new',
        lazy: lazyPage(() => import('@/pages/analysis/analysis-new-page'), 'AnalysisNewPage'),
      },
      {
        path: 'analyses/:analysisId/plans/:planId',
        lazy: lazyPage(() => import('@/pages/analysis/plan-page'), 'PlanPage'),
      },
      {
        path: 'analyses/:analysisId',
        lazy: lazyPage(() => import('@/pages/analysis/analysis-page'), 'AnalysisPage'),
      },
      { path: 'login', element: <LoginPage /> },
      { path: 'signup', element: <SignupPage /> },
      // Ввод кода из письма — второй шаг регистрации и входа.
      {
        path: 'signup/verify',
        lazy: lazyPage(() => import('@/pages/verify-code-page'), 'VerifySignupPage'),
      },
      {
        path: 'login/verify',
        lazy: lazyPage(() => import('@/pages/verify-code-page'), 'VerifyLoginPage'),
      },
      // «Забыли пароль?»: почта → код из письма → новый пароль.
      {
        path: 'login/forgot',
        lazy: lazyPage(() => import('@/pages/forgot-password-page'), 'ForgotPasswordPage'),
      },
      {
        path: 'login/forgot/verify',
        lazy: lazyPage(() => import('@/pages/verify-code-page'), 'VerifyPasswordResetPage'),
      },
      {
        path: 'login/forgot/new',
        lazy: lazyPage(() => import('@/pages/new-password-page'), 'NewPasswordPage'),
      },
      { path: 'pricing', element: <PricingPage /> },
      { path: 'privacy', lazy: lazyLegal('privacy') },
      { path: 'terms', lazy: lazyLegal('terms') },
      { path: 'payment-terms', lazy: lazyLegal('payment-terms') },
      { path: 'contacts', lazy: lazyPage(() => import('@/pages/contacts-page'), 'ContactsPage') },
      { path: 'about', lazy: lazyPage(() => import('@/pages/about-page'), 'AboutPage') },
      // Каталог моделей и тарифы чата — о закрытом чате (lib/product-switches.ts).
      {
        path: 'models',
        lazy: gatedLazy('chat', () => import('@/pages/models-page'), 'ModelsPage'),
      },
      { path: 'status', lazy: lazyPage(() => import('@/pages/status-page'), 'StatusPage') },
      {
        path: 'changelog',
        lazy: lazyPage(() => import('@/pages/changelog-page'), 'ChangelogPage'),
      },
      // Документация — о чате (модели, тарифы, лимиты): закрыта вместе с ним.
      { path: 'docs', lazy: gatedDocumentationPage },
      { path: 'docs/plans/:planId', lazy: gatedDocumentationPage },
      {
        path: 'docs/api',
        lazy: gatedLazy('developerApi', () => import('@/pages/api-docs-page'), 'ApiDocsPage'),
      },
      {
        // Адрес после успешной оплаты на сайте (цель «Покупка» в рекламных кабинетах).
        path: 'checkout/success',
        lazy: lazyPage(() => import('@/pages/checkout-success-page'), 'CheckoutSuccessPage'),
      },
      {
        path: 'checkout/:packId',
        lazy: lazyPage(() => import('@/pages/checkout-page'), 'CheckoutPage'),
      },
    ],
  },
  // Страница бота для клиентов: без шапки и меню сайта, встраивается на сайты бизнеса.
  {
    path: 'b/:slug',
    lazy: lazyPage(() => import('@/pages/bot/bot-page'), 'BotPage'),
    errorElement: <RouteErrorPage />,
  },
  // Кабинет внутри Telegram (мини-приложение бота): без шапки и боковой панели сайта.
  {
    path: 'tg',
    lazy: lazyPage(() => import('@/pages/telegram-app-page'), 'TelegramAppPage'),
    errorElement: <RouteErrorPage />,
  },
  {
    path: 'chat',
    element: (
      <FeatureGate feature="chat">
        <AppShell />
      </FeatureGate>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: chatPage },
      { path: ':conversationId', lazy: chatPage },
    ],
  },
  {
    path: 'code',
    element: (
      <FeatureGate feature="code">
        <AppShell />
      </FeatureGate>
    ),
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: codePage },
      { path: ':projectId', lazy: codePage },
    ],
  },
  {
    path: 'images',
    element: (
      <FeatureGate feature="images">
        <AppShell />
      </FeatureGate>
    ),
    errorElement: <RouteErrorPage />,
    children: [{ index: true, lazy: lazyPage(() => import('@/pages/images-page'), 'ImagesPage') }],
  },
  {
    path: 'settings',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: lazyPage(() => import('@/pages/settings-page'), 'SettingsPage') },
    ],
  },
  {
    path: 'api-docs',
    element: (
      <FeatureGate feature="developerApi">
        <AppShell />
      </FeatureGate>
    ),
    errorElement: <RouteErrorPage />,
    children: [{ index: true, lazy: apiDocsPage }],
  },
  {
    path: 'developers',
    element: (
      <FeatureGate feature="developerApi">
        <AppShell />
      </FeatureGate>
    ),
    errorElement: <RouteErrorPage />,
    children: [{ index: true, lazy: apiDocsPage }],
  },
  {
    path: 'onboarding',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: lazyPage(() => import('@/pages/onboarding-page'), 'OnboardingPage') },
    ],
  },
  {
    path: 'admin',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: lazyPage(() => import('@/pages/admin-page'), 'AdminPage') },
      {
        path: 'pricing',
        lazy: lazyPage(() => import('@/pages/admin/pricing-page'), 'AdminPricingPage'),
      },
    ],
  },
  {
    path: '*',
    element: <StandaloneLayout />,
    children: [{ path: '*', element: <NotFoundPage /> }],
  },
];
