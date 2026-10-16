/**
 * Стартовые наборы файлов для новых проектов. Минимальные, но рабочие: у каждого есть команда
 * проверки (`npm test`, `python -m unittest`), по которой агент убеждается, что правка не сломала код.
 */

export type TemplateId = 'empty' | 'node' | 'python' | 'web';

export const TEMPLATE_IDS: readonly TemplateId[] = ['empty', 'node', 'python', 'web'];

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}

function readme(name: string, body: string): string {
  return `# ${name}\n\n${body}\n`;
}

export function templateFiles(template: TemplateId, name: string): Record<string, string> {
  const title = name.trim() || 'Project';
  switch (template) {
    case 'node':
      return {
        'README.md': readme(title, 'Node.js проект.\n\n```bash\nnpm test\nnpm start\n```'),
        'package.json': `${JSON.stringify(
          {
            name:
              title
                .toLowerCase()
                .replace(/[^a-z0-9._-]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'project',
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: { start: 'node src/index.js', test: 'node --test' },
          },
          null,
          2,
        )}\n`,
        'src/index.js': `export function greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nif (import.meta.url === \`file://\${process.argv[1]}\`) {\n  console.log(greet('world'));\n}\n`,
        'test/index.test.js': `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { greet } from '../src/index.js';\n\ntest('greet', () => {\n  assert.equal(greet('world'), 'Hello, world!');\n});\n`,
        '.gitignore': 'node_modules\n.env\n',
      };
    case 'python':
      return {
        'README.md': readme(
          title,
          'Python проект.\n\n```bash\npython -m unittest\npython main.py\n```',
        ),
        'main.py': `def greet(name: str) -> str:\n    return f"Hello, {name}!"\n\n\nif __name__ == "__main__":\n    print(greet("world"))\n`,
        'test_main.py': `import unittest\n\nfrom main import greet\n\n\nclass GreetTest(unittest.TestCase):\n    def test_greet(self):\n        self.assertEqual(greet("world"), "Hello, world!")\n\n\nif __name__ == "__main__":\n    unittest.main()\n`,
        '.gitignore': '__pycache__/\n.venv/\n.env\n',
      };
    case 'web':
      return {
        'README.md': readme(title, 'Статический сайт: откройте `index.html` в браузере.'),
        'index.html': `<!doctype html>\n<html lang="ru">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${title.replace(/[<>&"]/g, '')}</title>\n    <link rel="stylesheet" href="style.css" />\n  </head>\n  <body>\n    <main>\n      <h1>${title.replace(/[<>&"]/g, '')}</h1>\n      <p id="message"></p>\n    </main>\n    <script type="module" src="script.js"></script>\n  </body>\n</html>\n`,
        'style.css': `:root {\n  color-scheme: light dark;\n  font-family: system-ui, sans-serif;\n}\n\nbody {\n  margin: 0;\n  display: grid;\n  min-height: 100vh;\n  place-items: center;\n}\n\nmain {\n  max-width: 40rem;\n  padding: 1rem;\n}\n`,
        'script.js': `document.querySelector('#message').textContent = 'Готово к работе.';\n`,
      };
    case 'empty':
    default:
      return { 'README.md': readme(title, 'Новый проект.') };
  }
}
