import type { CodeTab } from '@/components/docs/code-tabs';

/** Заглушка ключа в примерах, пока человек не создал свой. */
export const KEY_PLACEHOLDER = 'ketner_sk_...';

/** Строка в JSON внутри одинарных кавычек shell: экранируем кавычки и обратные слэши. */
function jsonString(value: string): string {
  return JSON.stringify(value).replace(/'/g, "'\\''");
}

export function getQuickstartSnippets(baseUrl: string, apiKey: string, prompt: string): CodeTab[] {
  return [
    {
      id: 'curl',
      label: 'cURL',
      language: 'bash',
      code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": ${jsonString(prompt)}}]
  }'`,
    },
    {
      id: 'python',
      label: 'Python',
      language: 'python',
      code: `# pip install openai
import os
from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key=os.environ["KETNER_API_KEY"],
)

stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": ${JSON.stringify(prompt)}}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`,
    },
    {
      id: 'javascript',
      label: 'JavaScript',
      language: 'javascript',
      code: `// npm install openai
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${baseUrl}',
  apiKey: process.env.KETNER_API_KEY,
});

const reply = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: ${JSON.stringify(prompt)} }],
});
console.log(reply.choices[0].message.content);`,
    },
  ];
}

export function getToolsSnippet(baseUrl: string, apiKey: string): CodeTab[] {
  return [
    {
      id: 'tools-curl',
      label: 'cURL',
      language: 'bash',
      code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ketner-pro",
    "messages": [{"role": "user", "content": "Прочитай src/app.ts и найди ошибку"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Прочитать файл проекта",
        "parameters": {
          "type": "object",
          "properties": {"path": {"type": "string"}},
          "required": ["path"]
        }
      }
    }]
  }'`,
    },
    {
      id: 'tools-reply',
      label: 'Ответ',
      language: 'json',
      code: `{
  "object": "chat.completion",
  "model": "ketner-pro",
  "choices": [{
    "index": 0,
    "finish_reason": "tool_calls",
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_1",
        "type": "function",
        "function": {"name": "read_file", "arguments": "{\\"path\\":\\"src/app.ts\\"}"}
      }]
    }
  }]
}`,
    },
  ];
}

export function getStructuredSnippet(baseUrl: string, apiKey: string): CodeTab[] {
  return [
    {
      id: 'json-python',
      label: 'Python',
      language: 'python',
      code: `import json, os
from openai import OpenAI

client = OpenAI(base_url="${baseUrl}", api_key=os.environ["KETNER_API_KEY"])

reply = client.chat.completions.create(
    model="ketner-pro",
    messages=[{"role": "user", "content": "Отзыв: «Доставили быстро, но коробка мятая»"}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "review",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "sentiment": {"type": "string", "enum": ["positive", "neutral", "negative"]},
                    "issues": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["sentiment", "issues"],
                "additionalProperties": False,
            },
        },
    },
)
print(json.loads(reply.choices[0].message.content))`,
    },
    {
      id: 'json-curl',
      label: 'cURL',
      language: 'bash',
      code: `curl ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ketner-pro",
    "messages": [{"role": "user", "content": "Три идеи для стартапа, JSON: {\\"ideas\\": [...]}"}],
    "response_format": {"type": "json_object"}
  }'`,
    },
  ];
}

export function getModelsSnippet(baseUrl: string, apiKey: string): CodeTab[] {
  return [
    {
      id: 'models-curl',
      label: 'cURL',
      language: 'bash',
      code: `curl ${baseUrl}/models \\
  -H "Authorization: Bearer ${apiKey}"`,
    },
  ];
}

export function getContinueConfigSnippet(baseUrl: string, apiKey: string): string {
  return `models:
  - name: Ketner Pro
    provider: openai
    model: ketner-pro
    apiBase: ${baseUrl}
    apiKey: ${apiKey}
  - name: Claude Sonnet 5.5 (Ketner)
    provider: openai
    model: claude-sonnet-5.5
    apiBase: ${baseUrl}
    apiKey: ${apiKey}`;
}
