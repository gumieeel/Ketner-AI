import type { RouteObject } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { StandaloneLayout } from '@/components/layout/standalone-layout';
import { ApiDocsPage } from '@/pages/api-docs-page';
import { ChatPage } from '@/pages/chat-page';
import { CheckoutPage } from '@/pages/checkout-page';
import { DocumentationPage } from '@/pages/documentation-page';
import { LandingPage } from '@/pages/landing-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { OnboardingPage } from '@/pages/onboarding-page';
import { PricingPage } from '@/pages/pricing-page';
import { RouteErrorPage } from '@/pages/route-error-page';
import { SettingsPage } from '@/pages/settings-page';
import { SignupPage } from '@/pages/signup-page';
import { AdminPage } from '@/pages/admin-page';

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
      { path: 'pricing', element: <PricingPage /> },
      { path: 'docs', element: <DocumentationPage /> },
      { path: 'docs/plans/:planId', element: <DocumentationPage /> },
      { path: 'docs/api', element: <ApiDocsPage /> },
      { path: 'checkout/:planId', element: <CheckoutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: 'chat',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: ':conversationId', element: <ChatPage /> },
    ],
  },
  {
    path: 'settings',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, element: <SettingsPage /> }],
  },
  {
    path: 'api-docs',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, element: <ApiDocsPage /> }],
  },
  {
    path: 'developers',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, element: <ApiDocsPage /> }],
  },
  {
    path: 'onboarding',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, element: <OnboardingPage /> }],
  },
  {
    path: 'admin',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, element: <AdminPage /> }],
  },
];
