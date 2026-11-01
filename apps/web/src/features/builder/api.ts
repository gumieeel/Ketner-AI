import { getAuthToken } from '@/features/auth/auth-store';
import planFacts from '@/features/billing/plan-facts.json';
import { checkSessionInvalid, getGuestId } from '@/features/chat/api';
import { readSseStream } from '@/features/chat/sse';
import { DiscoveryApiError } from '@/features/discovery/api';
import type { Language } from '@/features/preferences/preferences-store';
import { API_BASE } from '@/lib/api-config';

/** Клиент Builder (`/api/solutions`, docs/api.md): только после входа. */

export type AssistantTone = 'friendly' | 'neutral' | 'formal' | 'concise';

export interface AssistantConfig {
  name: string;
  purpose: string;
  instructions: string;
  tone: AssistantTone;
  knowledge: string;
  examples: Array<{ input: string; output: string }>;
  restrictions: string[];
  language: Language;
}

const PLATFORM = planFacts.platform.limits.assistants;

/** Лимиты — как на сервере: plan-facts.json сверяется тестом с services/discovery-limits.ts. */
export const LIMITS = {
  name: 80,
  purpose: 400,
  instructions: PLATFORM.instructionsChars,
  knowledge: PLATFORM.knowledgeChars,
  examples: PLATFORM.examples,
  exampleChars: 1200,
  restrictions: PLATFORM.restrictions,
  restrictionChars: 200,
  cases: PLATFORM.testCases,
  caseInput: 1000,
  criteria: PLATFORM.criteriaPerCase,
  criterionChars: 200,
  message: PLATFORM.messageChars,
} as const;

export type SolutionStatus = 'draft' | 'active' | 'paused';

export type SolutionType = 'assistant' | 'customer_bot';

/** Настройки страницы бота для клиентов (этап B): не версионируются, меняются сразу. */
export interface BotSettings {
  slug: string;
  greeting: string;
  quickReplies: string[];
  dailyCapCredits: number;
  corrections: Array<{ question: string; answer: string }>;
}

export const BOT_LIMITS = {
  slugMin: 3,
  slugMax: 40,
  greeting: 300,
  quickReplies: 4,
  quickReply: 60,
  dailyCapMin: 50,
  dailyCapMax: 50_000,
  corrections: 30,
  correctionChars: 600,
  message: 1000,
  /** Не больше стольких кредитов за один ответ бота (BOT_REPLY_CAP_USD на сервере). */
  replyMaxCredits: 30,
} as const;

export interface BotToday {
  replies: number;
  credits: number;
  newLeads: number;
}

export interface SolutionView {
  id: string;
  type: SolutionType;
  bot: BotSettings | null;
  /** Только в списке: расход и заявки бота за сегодня. */
  today?: BotToday | null;
  status: SolutionStatus;
  name: string;
  currentVersion: number;
  activeVersion: number | null;
  source: { analysisId: string; opportunityId: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestCase {
  id: string;
  position: number;
  input: string;
  criteria: string[];
  createdAt: string;
  updatedAt: string;
}

export type Verdict = 'pass' | 'fail';

export interface TestResult {
  caseId: string;
  input: string;
  criteria: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  answer: string;
  model: { id: string; name: string } | null;
  judge: {
    verdict: Verdict;
    notes: string;
    criteria: Array<{ criterion: string; met: boolean; note: string }>;
  } | null;
  manual: Verdict | null;
  error: { code: string; message: string } | null;
  chargedCredits: number;
}

export interface TestRunView {
  id: string;
  versionNumber: number;
  status: 'running' | 'done';
  results: TestResult[];
  chargedCredits: number;
  createdAt: string;
  finishedAt: string | null;
}

export type Readiness =
  | { ready: true }
  | {
      ready: false;
      reason: 'no_cases' | 'not_tested' | 'outdated' | 'running' | 'failed_cases';
      failed?: number;
    };

export interface SolutionDetails {
  solution: SolutionView;
  config: AssistantConfig;
  versions: Array<{ number: number; createdAt: string }>;
  cases: TestCase[];
  run: TestRunView | null;
  readiness: Readiness;
  testQuote: {
    cases: number;
    judgeModel: string;
    typicalCredits: number;
    maxCredits: number;
  } | null;
}

export interface ChatThread {
  id: string;
  solutionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  model: { id: string; name: string } | null;
  image: { id: string; url: string; downloadUrl: string; modelName: string } | null;
  status: 'complete' | 'error';
  createdAt: string;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Guest-Id': getGuestId(),
    ...extra,
  };
  const token = getAuthToken();
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/solutions${path}`, {
      ...init,
      headers: headers(init.headers as Record<string, string> | undefined),
      credentials: 'include',
    });
  } catch {
    throw new DiscoveryApiError('network_error', '', 0);
  }
  checkSessionInvalid(response);
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string; details?: Record<string, unknown> } }) | null;
  if (!response.ok) {
    throw new DiscoveryApiError(
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? '',
      response.status,
      body?.error?.details ?? {},
    );
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const enc = encodeURIComponent;

export async function listSolutions(): Promise<SolutionView[]> {
  return (await listAutomations()).solutions;
}

/** «Мои автоматизации»: решения и, если есть боты, остаток и «хватит на N дней». */
export function listAutomations(): Promise<{
  solutions: SolutionView[];
  runway: BotRunway | null;
}> {
  return call('');
}

export function fetchDraftQuote(): Promise<{
  model: string;
  typicalCredits: number;
  maxCredits: number;
}> {
  return call('/draft-quote');
}

export async function createBlankSolution(name: string, language: Language) {
  return (
    await call<{ solution: SolutionView }>('', { method: 'POST', ...json({ name, language }) })
  ).solution;
}

export async function createFromOpportunity(analysisId: string, opportunityId: string) {
  return (
    await call<{ solution: SolutionView }>('/from-opportunity', {
      method: 'POST',
      ...json({ analysisId, opportunityId, confirm: true }),
    })
  ).solution;
}

export function fetchSolution(id: string): Promise<SolutionDetails> {
  return call(`/${enc(id)}`);
}

export function saveConfig(id: string, config: AssistantConfig): Promise<SolutionDetails> {
  return call(`/${enc(id)}/config`, { method: 'PUT', ...json({ config }) });
}

export function restoreVersion(id: string, number: number): Promise<SolutionDetails> {
  return call(`/${enc(id)}/versions/${number}/restore`, { method: 'POST' });
}

export function saveCase(
  id: string,
  item: { input: string; criteria: string[] },
  caseId?: string,
): Promise<SolutionDetails> {
  return call(caseId ? `/${enc(id)}/cases/${enc(caseId)}` : `/${enc(id)}/cases`, {
    method: caseId ? 'PUT' : 'POST',
    ...json(item),
  });
}

export function deleteCase(id: string, caseId: string): Promise<SolutionDetails> {
  return call(`/${enc(id)}/cases/${enc(caseId)}`, { method: 'DELETE' });
}

export async function startTestRun(id: string): Promise<void> {
  await call(`/${enc(id)}/test-runs`, { method: 'POST', ...json({ confirm: true }) });
}

export function setVerdict(
  id: string,
  runId: string,
  caseId: string,
  verdict: Verdict | null,
): Promise<SolutionDetails> {
  return call(`/${enc(id)}/test-runs/${enc(runId)}/cases/${enc(caseId)}`, {
    method: 'PATCH',
    ...json({ verdict }),
  });
}

export function activateSolution(id: string): Promise<SolutionDetails> {
  return call(`/${enc(id)}/activate`, { method: 'POST' });
}

export function pauseSolution(id: string): Promise<SolutionDetails> {
  return call(`/${enc(id)}/pause`, { method: 'POST' });
}

export async function deleteSolution(id: string): Promise<void> {
  await call(`/${enc(id)}`, { method: 'DELETE' });
}

export async function listThreads(id: string): Promise<ChatThread[]> {
  return (await call<{ threads: ChatThread[] }>(`/${enc(id)}/threads`)).threads;
}

export async function createThread(id: string): Promise<ChatThread> {
  return (await call<{ thread: ChatThread }>(`/${enc(id)}/threads`, { method: 'POST' })).thread;
}

export async function listMessages(id: string, threadId: string): Promise<ChatMessage[]> {
  return (await call<{ messages: ChatMessage[] }>(`/${enc(id)}/threads/${enc(threadId)}/messages`))
    .messages;
}

/** Сообщение помощнику: ответ приходит потоком (delta), затем done с сохранённым сообщением. */
export async function sendMessage(
  id: string,
  threadId: string,
  content: string,
  handlers: {
    onDelta: (text: string) => void;
    onDone: (message: ChatMessage, chargedCredits: number | null) => void;
    onError: (error: DiscoveryApiError) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/solutions/${enc(id)}/threads/${enc(threadId)}/messages`, {
      method: 'POST',
      headers: headers(),
      credentials: 'include',
      body: JSON.stringify({ content }),
      ...(signal ? { signal } : {}),
    });
  } catch {
    handlers.onError(new DiscoveryApiError('network_error', '', 0));
    return;
  }
  checkSessionInvalid(response);
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    handlers.onError(
      new DiscoveryApiError(
        body?.error?.code ?? 'unknown_error',
        body?.error?.message ?? '',
        response.status,
      ),
    );
    return;
  }
  await readSseStream(response.body, (event) => {
    const data = JSON.parse(event.data) as Record<string, unknown>;
    if (event.event === 'delta') handlers.onDelta(String(data.content ?? ''));
    else if (event.event === 'done')
      handlers.onDone(
        data.message as ChatMessage,
        typeof data.chargedCredits === 'number' ? data.chargedCredits : null,
      );
    else if (event.event === 'error')
      handlers.onError(
        new DiscoveryApiError(String(data.code ?? 'error'), String(data.message ?? ''), 200),
      );
  });
}

// ─── Бот для клиентов: кабинет владельца ─────────────────────────────────────

/** Остаток владельца и «хватит на N дней» при среднем расходе ботов за неделю (этап C). */
export interface BotRunway {
  credits: number;
  dailyCredits: number;
  daysLeft: number | null;
}

export interface BotOverview {
  settings: BotSettings;
  today: BotToday;
  balance: BotRunway;
  publicUrl: string;
}

export interface BotConversationView {
  id: string;
  solutionId: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BotMessageView {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: { id: string; name: string } | null;
  offerContact: boolean;
  status: 'complete' | 'error';
  chargedCredits: number;
  createdAt: string;
}

export interface BotLeadView {
  id: string;
  solutionId: string;
  conversationId: string | null;
  name: string;
  contact: string;
  question: string;
  status: 'new' | 'done';
  createdAt: string;
  updatedAt: string;
}

export function fetchBot(id: string): Promise<BotOverview> {
  return call(`/${enc(id)}/bot`);
}

export function saveBot(id: string, patch: Partial<BotSettings>): Promise<BotOverview> {
  return call(`/${enc(id)}/bot`, { method: 'PUT', ...json(patch) });
}

export async function previewBot(
  id: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{ content: string; offerContact: boolean; chargedCredits: number }> {
  return (
    await call<{ reply: { content: string; offerContact: boolean; chargedCredits: number } }>(
      `/${enc(id)}/bot/preview`,
      { method: 'POST', ...json({ messages }) },
    )
  ).reply;
}

export async function listBotConversations(id: string): Promise<BotConversationView[]> {
  return (await call<{ conversations: BotConversationView[] }>(`/${enc(id)}/conversations`))
    .conversations;
}

export async function fetchBotConversation(
  id: string,
  conversationId: string,
): Promise<BotMessageView[]> {
  return (
    await call<{ messages: BotMessageView[] }>(`/${enc(id)}/conversations/${enc(conversationId)}`)
  ).messages;
}

export async function listBotLeads(id: string): Promise<BotLeadView[]> {
  return (await call<{ leads: BotLeadView[] }>(`/${enc(id)}/leads`)).leads;
}

export async function setBotLeadStatus(
  id: string,
  leadId: string,
  status: BotLeadView['status'],
): Promise<BotLeadView> {
  return (
    await call<{ lead: BotLeadView }>(`/${enc(id)}/leads/${enc(leadId)}`, {
      method: 'PATCH',
      ...json({ status }),
    })
  ).lead;
}
