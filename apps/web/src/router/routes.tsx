import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { StandaloneLayout } from '@/components/layout/standalone-layout';
import { LandingPage } from '@/pages/landing-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
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

const chatPage = lazyPage(() => import('@/pages/chat-page'), 'ChatPage');
const codePage = lazyPage(() => import('@/pages/code-page'), 'CodePage');
const documentationPage = lazyPage(() => import('@/pages/documentation-page'), 'DocumentationPage');
const apiDocsPage = lazyPage(() => import('@/pages/api-docs-page'), 'ApiDocsPage');

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
      { index: true, element: <LandingPage /> },
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
      { path: 'models', lazy: lazyPage(() => import('@/pages/models-page'), 'ModelsPage') },
      { path: 'status', lazy: lazyPage(() => import('@/pages/status-page'), 'StatusPage') },
      {
        path: 'changelog',
        lazy: lazyPage(() => import('@/pages/changelog-page'), 'ChangelogPage'),
      },
      { path: 'docs', lazy: documentationPage },
      { path: 'docs/plans/:planId', lazy: documentationPage },
      { path: 'docs/api', lazy: apiDocsPage },
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
  // Кабинет внутри Telegram (мини-приложение бота): без шапки и боковой панели сайта.
  {
    path: 'tg',
    lazy: lazyPage(() => import('@/pages/telegram-app-page'), 'TelegramAppPage'),
    errorElement: <RouteErrorPage />,
  },
  {
    path: 'chat',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: chatPage },
      { path: ':conversationId', lazy: chatPage },
    ],
  },
  {
    path: 'code',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: codePage },
      { path: ':projectId', lazy: codePage },
    ],
  },
  {
    path: 'images',
    element: <AppShell />,
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
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, lazy: apiDocsPage }],
  },
  {
    path: 'developers',
    element: <AppShell />,
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
    children: [{ index: true, lazy: lazyPage(() => import('@/pages/admin-page'), 'AdminPage') }],
  },
  {
    path: '*',
    element: <StandaloneLayout />,
    children: [{ path: '*', element: <NotFoundPage /> }],
  },
];
