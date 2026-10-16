import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { chunkFiles, readFolderFiles, readZipFile } from '@/features/code/import-readers';

const LIMITS = { maxFiles: 50, maxFileBytes: 1000, maxTotalBytes: 5000 };

function zipFile(entries: Record<string, string | Uint8Array>): File {
  const data: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(entries))
    // В jsdom TextEncoder отдаёт Uint8Array из другого окружения, а fflate проверяет instanceof.
    data[name] = Uint8Array.from(typeof value === 'string' ? strToU8(value) : value);
  const bytes = zipSync(data);
  return new File(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    'p.zip',
  );
}

describe('импорт кода в проект', () => {
  it('ZIP: берёт текстовые файлы, пропускает секреты, зависимости и двоичные', async () => {
    const file = zipFile({
      'src/a.ts': 'export const a = 1;\n',
      '.env': 'KEY=secret',
      'node_modules/x/index.js': 'x',
      'logo.png': new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
    });
    const result = await readZipFile(file, LIMITS);
    expect(result.files.map((f) => f.path)).toEqual(['src/a.ts']);
    const reasons = result.skipped.map((s) => s.path);
    expect(reasons).toEqual(
      expect.arrayContaining(['.env', 'node_modules/x/index.js', 'logo.png']),
    );
  });

  it('ZIP: убирает общий корневой каталог архива', async () => {
    const result = await readZipFile(zipFile({ 'proj/a.txt': 'a', 'proj/b/c.txt': 'c' }), LIMITS);
    expect(result.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b/c.txt']);
  });

  it('папка: путь берётся из webkitRelativePath без имени корня', async () => {
    const file = new File(['hi'], 'a.txt');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'root/src/a.txt' });
    const result = await readFolderFiles([file], LIMITS);
    expect(result.files).toEqual([{ path: 'src/a.txt', content: 'hi' }]);
  });

  it('слишком большие файлы пропускаются с причиной', async () => {
    const file = new File(['x'.repeat(2000)], 'big.txt');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'root/big.txt' });
    const result = await readFolderFiles([file], LIMITS);
    expect(result.files).toHaveLength(0);
    expect(result.skipped[0].path).toBe('big.txt');
  });

  it('файлы режутся на части ограниченного размера', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `f${i}.txt`,
      content: 'x'.repeat(400_000),
    }));
    const chunks = chunkFiles(files);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toHaveLength(10);
  });
});
