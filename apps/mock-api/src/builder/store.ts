/**
 * Хранилище Builder: помощники, версии настроек, тест-кейсы, прогоны, чат.
 *
 * Postgres — таблицы миграции `0004_solutions`; каждый запрос привязан к владельцу (`user_id`),
 * чужая запись не видна. Локально и в тестах — та же логика в памяти.
 */

import type { SqlRunner } from '../code/postgres-driver.js';
import type {
  AssistantConfig,
  BotConversation,
  BotLead,
  BotMessage,
  ChatMessage,
  ChatThread,
  Solution,
  SolutionVersion,
  TestCase,
  TestRun,
} from './types.js';

export interface BuilderStore {
  createSolution(solution: Solution, version: SolutionVersion, cases: TestCase[]): Promise<void>;
  getSolution(ownerId: string, id: string): Promise<Solution | null>;
  listSolutions(ownerId: string): Promise<Solution[]>;
  /** Записать, только если версия записи — `expectedVersion`; иначе null. */
  updateSolution(solution: Solution, expectedVersion: number): Promise<Solution | null>;
  deleteSolution(ownerId: string, id: string): Promise<boolean>;

  addVersion(ownerId: string, version: SolutionVersion): Promise<boolean>;
  getVersion(ownerId: string, solutionId: string, number: number): Promise<SolutionVersion | null>;
  listVersions(ownerId: string, solutionId: string): Promise<SolutionVersion[]>;

  listCases(ownerId: string, solutionId: string): Promise<TestCase[]>;
  /** Создать или изменить кейс помощника этого владельца. */
  saveCase(ownerId: string, item: TestCase): Promise<boolean>;
  deleteCase(ownerId: string, solutionId: string, caseId: string): Promise<boolean>;

  createRun(run: TestRun): Promise<boolean>;
  getRun(ownerId: string, id: string): Promise<TestRun | null>;
  latestRun(ownerId: string, solutionId: string): Promise<TestRun | null>;
  updateRun(run: TestRun, expectedVersion: number): Promise<TestRun | null>;

  createThread(thread: ChatThread): Promise<boolean>;
  getThread(ownerId: string, id: string): Promise<ChatThread | null>;
  listThreads(ownerId: string, solutionId: string): Promise<ChatThread[]>;
  touchThread(ownerId: string, id: string, at: string, title?: string): Promise<void>;
  addMessage(message: ChatMessage): Promise<boolean>;
  /** Последние `limit` сообщений по времени (старые — первыми). */
  listMessages(ownerId: string, threadId: string, limit: number): Promise<ChatMessage[]>;

  // ─── Бот для клиентов (этап B) ─────────────────────────────────────────────
  /** Бот по адресу страницы — без владельца: публичная страница бота. */
  getSolutionBySlug(slug: string): Promise<Solution | null>;
  slugTaken(slug: string): Promise<boolean>;
  createConversation(conversation: BotConversation): Promise<void>;
  /** Диалог этого бота (публичная сторона знает только бот и id диалога). */
  getConversation(solutionId: string, id: string): Promise<BotConversation | null>;
  /** Сохранить сообщение и обновить счётчик и время диалога. */
  addBotMessage(message: BotMessage): Promise<void>;
  /** Последние `limit` сообщений диалога (старые — первыми). */
  botHistory(solutionId: string, conversationId: string, limit: number): Promise<BotMessage[]>;
  listConversations(ownerId: string, solutionId: string, limit: number): Promise<BotConversation[]>;
  listBotMessages(
    ownerId: string,
    solutionId: string,
    conversationId: string,
  ): Promise<BotMessage[]>;
  /** Ответы бота и списанные кредиты начиная с `since` (ISO). */
  botUsageSince(
    solutionId: string,
    since: string,
  ): Promise<{ replies: number; creditsUsd: number }>;
  createLead(lead: BotLead): Promise<void>;
  listLeads(ownerId: string, solutionId: string, limit: number): Promise<BotLead[]>;
  setLeadStatus(
    ownerId: string,
    solutionId: string,
    leadId: string,
    status: BotLead['status'],
    at: string,
  ): Promise<BotLead | null>;
  countNewLeads(ownerId: string, solutionId: string): Promise<number>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryBuilderStore implements BuilderStore {
  private readonly solutions = new Map<string, Solution>();
  private readonly versions = new Map<string, SolutionVersion[]>();
  private readonly cases = new Map<string, TestCase>();
  private readonly runs = new Map<string, TestRun>();
  private readonly threads = new Map<string, ChatThread>();
  private readonly messages = new Map<string, ChatMessage>();
  private readonly conversations = new Map<string, BotConversation>();
  private readonly botMessages: BotMessage[] = [];
  private readonly leads = new Map<string, BotLead>();

  private owns(ownerId: string, solutionId: string): boolean {
    return this.solutions.get(solutionId)?.ownerId === ownerId;
  }

  async createSolution(solution: Solution, version: SolutionVersion, cases: TestCase[]) {
    const slug = solution.bot?.slug;
    if (slug && (await this.slugTaken(slug))) throw new Error('builder: адрес бота занят');
    this.solutions.set(solution.id, clone(solution));
    this.versions.set(solution.id, [clone(version)]);
    for (const item of cases) this.cases.set(item.id, clone(item));
  }

  async getSolution(ownerId: string, id: string) {
    const found = this.solutions.get(id);
    return found && found.ownerId === ownerId ? clone(found) : null;
  }

  async listSolutions(ownerId: string) {
    return [...this.solutions.values()]
      .filter((item) => item.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  async updateSolution(solution: Solution, expectedVersion: number) {
    const current = this.solutions.get(solution.id);
    if (!current || current.ownerId !== solution.ownerId || current.version !== expectedVersion)
      return null;
    const slug = solution.bot?.slug;
    if (
      slug &&
      [...this.solutions.values()].some(
        (item) => item.id !== solution.id && item.bot?.slug === slug,
      )
    )
      throw new Error('builder: адрес бота занят');
    const next = { ...clone(solution), version: expectedVersion + 1 };
    this.solutions.set(solution.id, next);
    return clone(next);
  }

  async deleteSolution(ownerId: string, id: string) {
    if (!this.owns(ownerId, id)) return false;
    this.solutions.delete(id);
    this.versions.delete(id);
    for (const [key, item] of this.cases) if (item.solutionId === id) this.cases.delete(key);
    for (const [key, item] of this.runs) if (item.solutionId === id) this.runs.delete(key);
    for (const [key, item] of this.conversations)
      if (item.solutionId === id) this.conversations.delete(key);
    for (let index = this.botMessages.length - 1; index >= 0; index -= 1)
      if (this.botMessages[index]!.solutionId === id) this.botMessages.splice(index, 1);
    for (const [key, item] of this.leads) if (item.solutionId === id) this.leads.delete(key);
    for (const [key, thread] of this.threads) {
      if (thread.solutionId !== id) continue;
      this.threads.delete(key);
      for (const [messageId, message] of this.messages)
        if (message.threadId === key) this.messages.delete(messageId);
    }
    return true;
  }

  async addVersion(ownerId: string, version: SolutionVersion) {
    if (!this.owns(ownerId, version.solutionId)) return false;
    const list = this.versions.get(version.solutionId) ?? [];
    if (list.some((item) => item.number === version.number)) return false;
    list.push(clone(version));
    this.versions.set(version.solutionId, list);
    return true;
  }

  async getVersion(ownerId: string, solutionId: string, number: number) {
    if (!this.owns(ownerId, solutionId)) return null;
    const found = (this.versions.get(solutionId) ?? []).find((item) => item.number === number);
    return found ? clone(found) : null;
  }

  async listVersions(ownerId: string, solutionId: string) {
    if (!this.owns(ownerId, solutionId)) return [];
    return [...(this.versions.get(solutionId) ?? [])]
      .sort((a, b) => b.number - a.number)
      .map(clone);
  }

  async listCases(ownerId: string, solutionId: string) {
    if (!this.owns(ownerId, solutionId)) return [];
    return [...this.cases.values()]
      .filter((item) => item.solutionId === solutionId)
      .sort((a, b) => a.position - b.position)
      .map(clone);
  }

  async saveCase(ownerId: string, item: TestCase) {
    if (!this.owns(ownerId, item.solutionId)) return false;
    const existing = this.cases.get(item.id);
    if (existing && existing.solutionId !== item.solutionId) return false;
    this.cases.set(item.id, clone(item));
    return true;
  }

  async deleteCase(ownerId: string, solutionId: string, caseId: string) {
    const found = this.cases.get(caseId);
    if (!found || found.solutionId !== solutionId || !this.owns(ownerId, solutionId)) return false;
    this.cases.delete(caseId);
    return true;
  }

  async createRun(run: TestRun) {
    if (!this.owns(run.ownerId, run.solutionId)) return false;
    this.runs.set(run.id, clone(run));
    return true;
  }

  async getRun(ownerId: string, id: string) {
    const found = this.runs.get(id);
    return found && found.ownerId === ownerId ? clone(found) : null;
  }

  async latestRun(ownerId: string, solutionId: string) {
    const list = [...this.runs.values()]
      .filter((item) => item.ownerId === ownerId && item.solutionId === solutionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list[0] ? clone(list[0]) : null;
  }

  async updateRun(run: TestRun, expectedVersion: number) {
    const current = this.runs.get(run.id);
    if (!current || current.ownerId !== run.ownerId || current.version !== expectedVersion)
      return null;
    const next = { ...clone(run), version: expectedVersion + 1 };
    this.runs.set(run.id, next);
    return clone(next);
  }

  async createThread(thread: ChatThread) {
    if (!this.owns(thread.ownerId, thread.solutionId)) return false;
    this.threads.set(thread.id, clone(thread));
    return true;
  }

  async getThread(ownerId: string, id: string) {
    const found = this.threads.get(id);
    return found && found.ownerId === ownerId ? clone(found) : null;
  }

  async listThreads(ownerId: string, solutionId: string) {
    return [...this.threads.values()]
      .filter((item) => item.ownerId === ownerId && item.solutionId === solutionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  async touchThread(ownerId: string, id: string, at: string, title?: string) {
    const found = this.threads.get(id);
    if (!found || found.ownerId !== ownerId) return;
    this.threads.set(id, { ...found, updatedAt: at, ...(title ? { title } : {}) });
  }

  async addMessage(message: ChatMessage) {
    const thread = this.threads.get(message.threadId);
    if (!thread || thread.ownerId !== message.ownerId) return false;
    this.messages.set(message.id, clone(message));
    return true;
  }

  async listMessages(ownerId: string, threadId: string, limit: number) {
    const thread = this.threads.get(threadId);
    if (!thread || thread.ownerId !== ownerId) return [];
    return [...this.messages.values()]
      .filter((item) => item.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit)
      .map(clone);
  }

  async getSolutionBySlug(slug: string) {
    const found = [...this.solutions.values()].find((item) => item.bot?.slug === slug);
    return found ? clone(found) : null;
  }

  async slugTaken(slug: string) {
    return [...this.solutions.values()].some((item) => item.bot?.slug === slug);
  }

  async createConversation(conversation: BotConversation) {
    this.conversations.set(conversation.id, clone(conversation));
  }

  async getConversation(solutionId: string, id: string) {
    const found = this.conversations.get(id);
    return found && found.solutionId === solutionId ? clone(found) : null;
  }

  async addBotMessage(message: BotMessage) {
    this.botMessages.push(clone(message));
    const conversation = this.conversations.get(message.conversationId);
    if (conversation) {
      conversation.messageCount += 1;
      conversation.updatedAt = message.createdAt;
    }
  }

  async botHistory(solutionId: string, conversationId: string, limit: number) {
    return this.botMessages
      .filter((item) => item.solutionId === solutionId && item.conversationId === conversationId)
      .slice(-limit)
      .map(clone);
  }

  async listConversations(ownerId: string, solutionId: string, limit: number) {
    if (!this.owns(ownerId, solutionId)) return [];
    return [...this.conversations.values()]
      .filter((item) => item.solutionId === solutionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(clone);
  }

  async listBotMessages(ownerId: string, solutionId: string, conversationId: string) {
    if (!this.owns(ownerId, solutionId)) return [];
    return this.botMessages
      .filter((item) => item.solutionId === solutionId && item.conversationId === conversationId)
      .map(clone);
  }

  async botUsageSince(solutionId: string, since: string) {
    const items = this.botMessages.filter(
      (item) =>
        item.solutionId === solutionId && item.role === 'assistant' && item.createdAt >= since,
    );
    return {
      replies: items.length,
      creditsUsd: Math.round(items.reduce((sum, item) => sum + item.creditsUsd, 0) * 1e6) / 1e6,
    };
  }

  async createLead(lead: BotLead) {
    this.leads.set(lead.id, clone(lead));
  }

  async listLeads(ownerId: string, solutionId: string, limit: number) {
    if (!this.owns(ownerId, solutionId)) return [];
    return [...this.leads.values()]
      .filter((item) => item.solutionId === solutionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async setLeadStatus(
    ownerId: string,
    solutionId: string,
    leadId: string,
    status: BotLead['status'],
    at: string,
  ) {
    const found = this.leads.get(leadId);
    if (!found || found.solutionId !== solutionId || found.ownerId !== ownerId) return null;
    found.status = status;
    found.updatedAt = at;
    return clone(found);
  }

  async countNewLeads(ownerId: string, solutionId: string) {
    return [...this.leads.values()].filter(
      (item) => item.solutionId === solutionId && item.ownerId === ownerId && item.status === 'new',
    ).length;
  }
}

// ─── Postgres ─────────────────────────────────────────────────────────────────

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const iso = (value: string | Date): string => new Date(value).toISOString();

interface SolutionRow {
  id: string;
  user_id: string;
  type: Solution['type'];
  template: string;
  bot: unknown;
  status: Solution['status'];
  name: string;
  current_version: number | string;
  active_version: number | string | null;
  source: unknown;
  version: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

const SOLUTION_COLUMNS = `id, user_id, type, status, name, current_version, active_version, source,
  version, created_at, updated_at, bot, template`;

function toSolution(row: SolutionRow): Solution {
  return {
    id: row.id,
    ownerId: row.user_id,
    type: row.type,
    template: row.template,
    bot: json(row.bot, null),
    status: row.status,
    name: row.name,
    currentVersion: Number(row.current_version),
    activeVersion: row.active_version === null ? null : Number(row.active_version),
    source: json(row.source, null),
    version: Number(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

interface VersionRow {
  solution_id: string;
  number: number | string;
  config: unknown;
  created_at: string | Date;
}

const toVersion = (row: VersionRow): SolutionVersion => ({
  solutionId: row.solution_id,
  number: Number(row.number),
  config: json<AssistantConfig>(row.config, {} as AssistantConfig),
  createdAt: iso(row.created_at),
});

interface CaseRow {
  id: string;
  solution_id: string;
  position: number | string;
  input: string;
  criteria: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

const toCase = (row: CaseRow): TestCase => ({
  id: row.id,
  solutionId: row.solution_id,
  position: Number(row.position),
  input: row.input,
  criteria: json<string[]>(row.criteria, []),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

interface RunRow {
  id: string;
  solution_id: string;
  user_id: string;
  version_number: number | string;
  cases_hash: string;
  status: TestRun['status'];
  results: unknown;
  version: number | string;
  created_at: string | Date;
  finished_at: string | Date | null;
}

const RUN_COLUMNS = `id, solution_id, user_id, version_number, cases_hash, status, results, version,
  created_at, finished_at`;

const toRun = (row: RunRow): TestRun => ({
  id: row.id,
  solutionId: row.solution_id,
  ownerId: row.user_id,
  versionNumber: Number(row.version_number),
  casesHash: row.cases_hash,
  status: row.status,
  results: json(row.results, []),
  version: Number(row.version),
  createdAt: iso(row.created_at),
  finishedAt: row.finished_at ? iso(row.finished_at) : null,
});

interface ThreadRow {
  id: string;
  solution_id: string;
  user_id: string;
  title: string;
  created_at: string | Date;
  updated_at: string | Date;
}

const toThread = (row: ThreadRow): ChatThread => ({
  id: row.id,
  solutionId: row.solution_id,
  ownerId: row.user_id,
  title: row.title,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

interface MessageRow {
  id: string;
  thread_id: string;
  user_id: string;
  role: ChatMessage['role'];
  content: string;
  data: unknown;
  status: ChatMessage['status'];
  created_at: string | Date;
}

const toMessage = (row: MessageRow): ChatMessage => {
  const data = json<Pick<ChatMessage, 'model' | 'image'>>(row.data, { model: null, image: null });
  return {
    id: row.id,
    threadId: row.thread_id,
    ownerId: row.user_id,
    role: row.role,
    content: row.content,
    model: data.model ?? null,
    image: data.image ?? null,
    status: row.status,
    createdAt: iso(row.created_at),
  };
};

interface ConversationRow {
  id: string;
  solution_id: string;
  user_id: string;
  visitor_id: string;
  message_count: number | string;
  created_at: string | Date;
  updated_at: string | Date;
}

const CONVERSATION_COLUMNS =
  'id, solution_id, user_id, visitor_id, message_count, created_at, updated_at';

const toConversation = (row: ConversationRow): BotConversation => ({
  id: row.id,
  solutionId: row.solution_id,
  ownerId: row.user_id,
  visitorId: row.visitor_id,
  messageCount: Number(row.message_count),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

interface BotMessageRow {
  id: string;
  conversation_id: string;
  solution_id: string;
  user_id: string;
  role: BotMessage['role'];
  content: string;
  data: unknown;
  credits_usd: number | string;
  status: BotMessage['status'];
  created_at: string | Date;
}

const BOT_MESSAGE_COLUMNS =
  'id, conversation_id, solution_id, user_id, role, content, data, credits_usd, status, created_at';

const toBotMessage = (row: BotMessageRow): BotMessage => {
  const data = json<Pick<BotMessage, 'model' | 'offerContact'>>(row.data, {
    model: null,
    offerContact: false,
  });
  return {
    id: row.id,
    conversationId: row.conversation_id,
    solutionId: row.solution_id,
    ownerId: row.user_id,
    role: row.role,
    content: row.content,
    model: data.model ?? null,
    offerContact: Boolean(data.offerContact),
    creditsUsd: Number(row.credits_usd),
    status: row.status,
    createdAt: iso(row.created_at),
  };
};

interface LeadRow {
  id: string;
  solution_id: string;
  user_id: string;
  conversation_id: string | null;
  name: string;
  contact: string;
  question: string;
  status: BotLead['status'];
  created_at: string | Date;
  updated_at: string | Date;
}

const LEAD_COLUMNS =
  'id, solution_id, user_id, conversation_id, name, contact, question, status, created_at, updated_at';

const toLead = (row: LeadRow): BotLead => ({
  id: row.id,
  solutionId: row.solution_id,
  ownerId: row.user_id,
  conversationId: row.conversation_id,
  name: row.name,
  contact: row.contact,
  question: row.question,
  status: row.status,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export class PostgresBuilderStore implements BuilderStore {
  constructor(private readonly db: SqlRunner) {}

  async createSolution(solution: Solution, version: SolutionVersion, cases: TestCase[]) {
    await this.db.query(
      `INSERT INTO solutions (${SOLUTION_COLUMNS}, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9, $10::timestamptz, $11::timestamptz,
               $12::text::jsonb, $14, $13)`,
      [
        solution.id,
        solution.ownerId,
        solution.type,
        solution.status,
        solution.name,
        solution.currentVersion,
        solution.activeVersion,
        JSON.stringify(solution.source),
        solution.version,
        solution.createdAt,
        solution.updatedAt,
        JSON.stringify(solution.bot ?? null),
        solution.bot?.slug ?? null,
        solution.template,
      ],
    );
    await this.addVersion(solution.ownerId, version);
    for (const item of cases) await this.saveCase(solution.ownerId, item);
  }

  async getSolution(ownerId: string, id: string) {
    const rows = await this.db.query<SolutionRow>(
      `SELECT ${SOLUTION_COLUMNS} FROM solutions WHERE id = $1 AND user_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? toSolution(rows[0]) : null;
  }

  async listSolutions(ownerId: string) {
    const rows = await this.db.query<SolutionRow>(
      `SELECT ${SOLUTION_COLUMNS} FROM solutions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [ownerId],
    );
    return rows.map(toSolution);
  }

  async updateSolution(solution: Solution, expectedVersion: number) {
    const rows = await this.db.query<SolutionRow>(
      `UPDATE solutions SET status = $3, name = $4, current_version = $5, active_version = $6,
         updated_at = $7::timestamptz, bot = $9::text::jsonb, slug = $10, version = version + 1
       WHERE id = $1 AND user_id = $2 AND version = $8
       RETURNING ${SOLUTION_COLUMNS}`,
      [
        solution.id,
        solution.ownerId,
        solution.status,
        solution.name,
        solution.currentVersion,
        solution.activeVersion,
        solution.updatedAt,
        expectedVersion,
        JSON.stringify(solution.bot ?? null),
        solution.bot?.slug ?? null,
      ],
    );
    return rows[0] ? toSolution(rows[0]) : null;
  }

  async deleteSolution(ownerId: string, id: string) {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM solutions WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, ownerId],
    );
    return rows.length > 0;
  }

  async addVersion(ownerId: string, version: SolutionVersion) {
    const rows = await this.db.query<{ number: number }>(
      `INSERT INTO solution_versions (solution_id, number, config, created_at)
       SELECT $1, $2, $3::text::jsonb, $4::timestamptz
       WHERE EXISTS (SELECT 1 FROM solutions WHERE id = $1 AND user_id = $5)
       ON CONFLICT DO NOTHING RETURNING number`,
      [
        version.solutionId,
        version.number,
        JSON.stringify(version.config),
        version.createdAt,
        ownerId,
      ],
    );
    return rows.length > 0;
  }

  async getVersion(ownerId: string, solutionId: string, number: number) {
    const rows = await this.db.query<VersionRow>(
      `SELECT v.solution_id, v.number, v.config, v.created_at FROM solution_versions v
       JOIN solutions s ON s.id = v.solution_id
       WHERE v.solution_id = $1 AND v.number = $2 AND s.user_id = $3`,
      [solutionId, number, ownerId],
    );
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async listVersions(ownerId: string, solutionId: string) {
    const rows = await this.db.query<VersionRow>(
      `SELECT v.solution_id, v.number, v.config, v.created_at FROM solution_versions v
       JOIN solutions s ON s.id = v.solution_id
       WHERE v.solution_id = $1 AND s.user_id = $2 ORDER BY v.number DESC`,
      [solutionId, ownerId],
    );
    return rows.map(toVersion);
  }

  async listCases(ownerId: string, solutionId: string) {
    const rows = await this.db.query<CaseRow>(
      `SELECT id, solution_id, position, input, criteria, created_at, updated_at
       FROM solution_test_cases WHERE solution_id = $1 AND user_id = $2 ORDER BY position`,
      [solutionId, ownerId],
    );
    return rows.map(toCase);
  }

  async saveCase(ownerId: string, item: TestCase) {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO solution_test_cases
         (id, solution_id, user_id, position, input, criteria, created_at, updated_at)
       SELECT $1, $2, $3, $4, $5, $6::text::jsonb, $7::timestamptz, $8::timestamptz
       WHERE EXISTS (SELECT 1 FROM solutions WHERE id = $2 AND user_id = $3)
       ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, input = EXCLUDED.input,
         criteria = EXCLUDED.criteria, updated_at = EXCLUDED.updated_at
       WHERE solution_test_cases.solution_id = EXCLUDED.solution_id
         AND solution_test_cases.user_id = EXCLUDED.user_id
       RETURNING id`,
      [
        item.id,
        item.solutionId,
        ownerId,
        item.position,
        item.input,
        JSON.stringify(item.criteria),
        item.createdAt,
        item.updatedAt,
      ],
    );
    return rows.length > 0;
  }

  async deleteCase(ownerId: string, solutionId: string, caseId: string) {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM solution_test_cases WHERE id = $1 AND solution_id = $2 AND user_id = $3
       RETURNING id`,
      [caseId, solutionId, ownerId],
    );
    return rows.length > 0;
  }

  async createRun(run: TestRun) {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO solution_test_runs (${RUN_COLUMNS})
       SELECT $1, $2, $3, $4, $5, $6, $7::text::jsonb, $8, $9::timestamptz, $10::timestamptz
       WHERE EXISTS (SELECT 1 FROM solutions WHERE id = $2 AND user_id = $3)
       RETURNING id`,
      [
        run.id,
        run.solutionId,
        run.ownerId,
        run.versionNumber,
        run.casesHash,
        run.status,
        JSON.stringify(run.results),
        run.version,
        run.createdAt,
        run.finishedAt,
      ],
    );
    return rows.length > 0;
  }

  async getRun(ownerId: string, id: string) {
    const rows = await this.db.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM solution_test_runs WHERE id = $1 AND user_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async latestRun(ownerId: string, solutionId: string) {
    const rows = await this.db.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM solution_test_runs WHERE solution_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [solutionId, ownerId],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async updateRun(run: TestRun, expectedVersion: number) {
    const rows = await this.db.query<RunRow>(
      `UPDATE solution_test_runs SET status = $3, results = $4::text::jsonb,
         finished_at = $5::timestamptz, version = version + 1
       WHERE id = $1 AND user_id = $2 AND version = $6 RETURNING ${RUN_COLUMNS}`,
      [
        run.id,
        run.ownerId,
        run.status,
        JSON.stringify(run.results),
        run.finishedAt,
        expectedVersion,
      ],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async createThread(thread: ChatThread) {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO solution_threads (id, solution_id, user_id, title, created_at, updated_at)
       SELECT $1, $2, $3, $4, $5::timestamptz, $6::timestamptz
       WHERE EXISTS (SELECT 1 FROM solutions WHERE id = $2 AND user_id = $3)
       RETURNING id`,
      [
        thread.id,
        thread.solutionId,
        thread.ownerId,
        thread.title,
        thread.createdAt,
        thread.updatedAt,
      ],
    );
    return rows.length > 0;
  }

  async getThread(ownerId: string, id: string) {
    const rows = await this.db.query<ThreadRow>(
      `SELECT id, solution_id, user_id, title, created_at, updated_at FROM solution_threads
       WHERE id = $1 AND user_id = $2`,
      [id, ownerId],
    );
    return rows[0] ? toThread(rows[0]) : null;
  }

  async listThreads(ownerId: string, solutionId: string) {
    const rows = await this.db.query<ThreadRow>(
      `SELECT id, solution_id, user_id, title, created_at, updated_at FROM solution_threads
       WHERE solution_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 50`,
      [solutionId, ownerId],
    );
    return rows.map(toThread);
  }

  async touchThread(ownerId: string, id: string, at: string, title?: string) {
    await this.db.query(
      `UPDATE solution_threads SET updated_at = $3::timestamptz, title = COALESCE($4, title)
       WHERE id = $1 AND user_id = $2`,
      [id, ownerId, at, title ?? null],
    );
  }

  async addMessage(message: ChatMessage) {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO solution_messages (id, thread_id, user_id, role, content, data, status, created_at)
       SELECT $1, $2, $3, $4, $5, $6::text::jsonb, $7, $8::timestamptz
       WHERE EXISTS (SELECT 1 FROM solution_threads WHERE id = $2 AND user_id = $3)
       RETURNING id`,
      [
        message.id,
        message.threadId,
        message.ownerId,
        message.role,
        message.content,
        JSON.stringify({ model: message.model, image: message.image }),
        message.status,
        message.createdAt,
      ],
    );
    return rows.length > 0;
  }

  async listMessages(ownerId: string, threadId: string, limit: number) {
    const rows = await this.db.query<MessageRow>(
      `SELECT * FROM (
         SELECT id, thread_id, user_id, role, content, data, status, created_at
         FROM solution_messages WHERE thread_id = $1 AND user_id = $2
         ORDER BY created_at DESC LIMIT $3
       ) recent ORDER BY created_at`,
      [threadId, ownerId, limit],
    );
    return rows.map(toMessage);
  }

  async getSolutionBySlug(slug: string) {
    const rows = await this.db.query<SolutionRow>(
      `SELECT ${SOLUTION_COLUMNS} FROM solutions WHERE slug = $1`,
      [slug],
    );
    return rows[0] ? toSolution(rows[0]) : null;
  }

  async slugTaken(slug: string) {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM solutions WHERE slug = $1`, [
      slug,
    ]);
    return rows.length > 0;
  }

  async createConversation(conversation: BotConversation) {
    await this.db.query(
      `INSERT INTO bot_conversations (${CONVERSATION_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)`,
      [
        conversation.id,
        conversation.solutionId,
        conversation.ownerId,
        conversation.visitorId,
        conversation.messageCount,
        conversation.createdAt,
        conversation.updatedAt,
      ],
    );
  }

  async getConversation(solutionId: string, id: string) {
    const rows = await this.db.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM bot_conversations WHERE id = $1 AND solution_id = $2`,
      [id, solutionId],
    );
    return rows[0] ? toConversation(rows[0]) : null;
  }

  async addBotMessage(message: BotMessage) {
    await this.db.query(
      `INSERT INTO bot_messages (${BOT_MESSAGE_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7::text::jsonb, $8, $9, $10::timestamptz)`,
      [
        message.id,
        message.conversationId,
        message.solutionId,
        message.ownerId,
        message.role,
        message.content,
        JSON.stringify({ model: message.model, offerContact: message.offerContact }),
        message.creditsUsd,
        message.status,
        message.createdAt,
      ],
    );
    await this.db.query(
      `UPDATE bot_conversations SET message_count = message_count + 1, updated_at = $2::timestamptz
       WHERE id = $1`,
      [message.conversationId, message.createdAt],
    );
  }

  async botHistory(solutionId: string, conversationId: string, limit: number) {
    const rows = await this.db.query<BotMessageRow>(
      `SELECT ${BOT_MESSAGE_COLUMNS} FROM (
         SELECT ${BOT_MESSAGE_COLUMNS} FROM bot_messages
         WHERE conversation_id = $1 AND solution_id = $2 ORDER BY created_at DESC LIMIT $3
       ) last ORDER BY created_at`,
      [conversationId, solutionId, limit],
    );
    return rows.map(toBotMessage);
  }

  async listConversations(ownerId: string, solutionId: string, limit: number) {
    const rows = await this.db.query<ConversationRow>(
      `SELECT ${CONVERSATION_COLUMNS} FROM bot_conversations
       WHERE solution_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT $3`,
      [solutionId, ownerId, limit],
    );
    return rows.map(toConversation);
  }

  async listBotMessages(ownerId: string, solutionId: string, conversationId: string) {
    const rows = await this.db.query<BotMessageRow>(
      `SELECT ${BOT_MESSAGE_COLUMNS} FROM bot_messages
       WHERE conversation_id = $1 AND solution_id = $2 AND user_id = $3 ORDER BY created_at LIMIT 500`,
      [conversationId, solutionId, ownerId],
    );
    return rows.map(toBotMessage);
  }

  async botUsageSince(solutionId: string, since: string) {
    const rows = await this.db.query<{ replies: number | string; credits: number | string | null }>(
      `SELECT count(*) AS replies, sum(credits_usd) AS credits FROM bot_messages
       WHERE solution_id = $1 AND role = 'assistant' AND created_at >= $2::timestamptz`,
      [solutionId, since],
    );
    return {
      replies: Number(rows[0]?.replies ?? 0),
      creditsUsd: Math.round(Number(rows[0]?.credits ?? 0) * 1e6) / 1e6,
    };
  }

  async createLead(lead: BotLead) {
    await this.db.query(
      `INSERT INTO bot_leads (${LEAD_COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)`,
      [
        lead.id,
        lead.solutionId,
        lead.ownerId,
        lead.conversationId,
        lead.name,
        lead.contact,
        lead.question,
        lead.status,
        lead.createdAt,
        lead.updatedAt,
      ],
    );
  }

  async listLeads(ownerId: string, solutionId: string, limit: number) {
    const rows = await this.db.query<LeadRow>(
      `SELECT ${LEAD_COLUMNS} FROM bot_leads WHERE solution_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT $3`,
      [solutionId, ownerId, limit],
    );
    return rows.map(toLead);
  }

  async setLeadStatus(
    ownerId: string,
    solutionId: string,
    leadId: string,
    status: BotLead['status'],
    at: string,
  ) {
    const rows = await this.db.query<LeadRow>(
      `UPDATE bot_leads SET status = $4, updated_at = $5::timestamptz
       WHERE id = $1 AND solution_id = $2 AND user_id = $3 RETURNING ${LEAD_COLUMNS}`,
      [leadId, solutionId, ownerId, status, at],
    );
    return rows[0] ? toLead(rows[0]) : null;
  }

  async countNewLeads(ownerId: string, solutionId: string) {
    const rows = await this.db.query<{ count: number | string }>(
      `SELECT count(*) AS count FROM bot_leads WHERE solution_id = $1 AND user_id = $2 AND status = 'new'`,
      [solutionId, ownerId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
