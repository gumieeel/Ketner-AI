/**
 * Кодовые сниппеты и примеры конфигураций для API & CLI документации Ketner AI.
 */

export function getCliInstallSnippets(): Record<string, string> {
  return {
    powershell: `# Способ 1: Установка через npm (рекомендуется)
npm install -g @ketner/agent-cli

# Способ 2: Быстрая автоматическая установка через PowerShell
irm https://ketner.ai/install.ps1 | iex`,
    macos: `# Способ 1: Через Homebrew
brew install ketner-ai/tap/ketner

# Способ 2: Через npm
npm install -g @ketner/agent-cli

# Способ 3: Через cURL скрипт
curl -fsSL https://ketner.ai/install.sh | bash`,
    linux: `# Способ 1: Через официальный скрипт установки
curl -fsSL https://ketner.ai/install.sh | bash

# Способ 2: Через npm
npm install -g @ketner/agent-cli`,
  };
}

export function getCliAuthSnippets(apiKey: string): Record<string, string> {
  return {
    powershell: `# Вариант А: Быстрый интерактивный вход
ketner auth login

# Вариант Б: Установка системной переменной (сохраняется навсегда)
[System.Environment]::SetEnvironmentVariable('KETNER_API_KEY', '${apiKey}', 'User')
$env:KETNER_API_KEY = '${apiKey}'`,
    bash: `# Вариант А: Интерактивный вход
ketner auth login

# Вариант Б: Экспорт переменной в файл профиля (~/.zshrc или ~/.bashrc)
echo 'export KETNER_API_KEY="${apiKey}"' >> ~/.zshrc
source ~/.zshrc`,
  };
}

export const CLI_RUN_SNIPPET = `# Перейдите в корень вашего проекта
cd ~/projects/my-awesome-app

# 1. Запуск интерактивной сессии с агентом
ketner run --model gpt-6-astra

# 2. Передача конкретной команды напрямую
ketner run "Найди и исправь падающие тесты в auth-flow.test.tsx и запусти npm test"

# 3. Запуск фонового демона с локальным Web UI на http://localhost:4040
ketner agent start --port 4040 --workspace .`;

export function getContinueConfigSnippet(apiKey: string): string {
  return `{
  "models": [
    {
      "title": "Ketner GPT-6 Astra",
      "provider": "openai",
      "model": "gpt-6-astra",
      "apiBase": "https://api.ketner.ai/v1",
      "apiKey": "${apiKey}"
    },
    {
      "title": "Ketner Claude Fable 5.5",
      "provider": "openai",
      "model": "claude-fable-5.5",
      "apiBase": "https://api.ketner.ai/v1",
      "apiKey": "${apiKey}"
    },
    {
      "title": "Ketner Gemini 3.8 Pro",
      "provider": "openai",
      "model": "gemini-3.8-pro",
      "apiBase": "https://api.ketner.ai/v1",
      "apiKey": "${apiKey}"
    }
  ]
}`;
}

export function getMcpConfigSnippet(apiKey: string, os: 'windows' | 'macos' | 'linux'): string {
  const projectPath =
    os === 'windows' ? 'C:\\\\Users\\\\admin\\\\Projects' : '/Users/admin/projects';

  return `{
  "mcpServers": {
    "ketner-ai": {
      "command": "npx",
      "args": ["-y", "@ketner/mcp-server@latest"],
      "env": {
        "KETNER_API_KEY": "${apiKey}",
        "KETNER_BASE_URL": "https://api.ketner.ai/v1",
        "DEFAULT_MODEL": "gpt-6-astra"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${projectPath}"
      ]
    },
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "./app.db"]
    }
  }
}`;
}

export function getSdkSnippets(apiKey: string) {
  return [
    {
      id: 'curl',
      label: 'cURL',
      language: 'bash',
      code: `curl https://api.ketner.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "gpt-6-astra",
    "messages": [{"role": "user", "content": "Привет, Ketner AI!"}],
    "stream": true
  }'`,
    },
    {
      id: 'python',
      label: 'Python',
      language: 'python',
      code: `import os
from openai import OpenAI

# Инициализируем клиент с эндпоинтом Ketner AI
client = OpenAI(
    base_url="https://api.ketner.ai/v1",
    api_key=os.environ.get("KETNER_API_KEY", "${apiKey}"),
)

print("Запрос к GPT-6 Astra на локальной машине...")

# Запуск стриминга ответа
stream = client.chat.completions.create(
    model="gpt-6-astra",
    messages=[
        {
            "role": "system",
            "content": "Ты автономный AI-ассистент разработчика. Твой код точен и сразу готов к запуску.",
        },
        {
            "role": "user",
            "content": "Напиши функцию на Python для параллельной загрузки 10 файлов через asyncio",
        },
    ],
    stream=True,
)

for chunk in stream:
    token = chunk.choices[0].delta.content or ""
    print(token, end="", flush=True)

print()`,
    },
    {
      id: 'node',
      label: 'Node.js',
      language: 'typescript',
      code: `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.ketner.ai/v1',
  apiKey: process.env.KETNER_API_KEY || '${apiKey}',
});

async function main() {
  const stream = await client.chat.completions.create({
    model: 'claude-fable-5.5',
    messages: [{ role: 'user', content: 'Оптимизируй этот SQL-запрос для PostgreSQL' }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '');
  }
}

main().catch(console.error);`,
    },
  ];
}

export function getCompletionsSnippets(apiKey: string) {
  return [
    {
      id: 'curl',
      label: 'cURL',
      language: 'bash',
      code: `curl -X POST https://api.ketner.ai/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -d '{
    "model": "gpt-6-astra",
    "messages": [
      {"role": "system", "content": "You are a code review assistant."},
      {"role": "user", "content": "Review this PR diff"}
    ],
    "stream": false,
    "temperature": 0.2
  }'`,
    },
    {
      id: 'python',
      label: 'Python',
      language: 'python',
      code: `from openai import OpenAI

client = OpenAI(
    base_url="https://api.ketner.ai/v1",
    api_key="${apiKey}",
)

response = client.chat.completions.create(
    model="gpt-6-astra",
    messages=[
        {"role": "system", "content": "You are a code review assistant."},
        {"role": "user", "content": "Review this PR diff"},
    ],
    temperature=0.2,
)

print(response.choices[0].message.content)`,
    },
    {
      id: 'response',
      label: 'Response (200 OK)',
      language: 'json',
      code: `{
  "id": "chatcmpl-9f83a21b",
  "object": "chat.completion",
  "created": 1727616000,
  "model": "gpt-6-astra",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Код выглядит чисто, критических замечаний нет."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 28,
    "completion_tokens": 14,
    "total_tokens": 42
  }
}`,
    },
  ];
}

export function getConversationsSnippets(apiKey: string) {
  return [
    {
      id: 'curl',
      label: 'cURL',
      language: 'bash',
      code: `curl https://api.ketner.ai/v1/conversations \\
  -H "Authorization: Bearer ${apiKey}"`,
    },
    {
      id: 'response',
      label: 'Response (200 OK)',
      language: 'json',
      code: `{
  "object": "list",
  "data": [
    {
      "id": "conv_a8b9c1d2",
      "title": "Рефакторинг токенов дизайна",
      "model": "gpt-6-astra",
      "created_at": 1727616000,
      "message_count": 8
    }
  ],
  "has_more": false
}`,
    },
  ];
}
