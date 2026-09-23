/**
 * Имитация стриминга ответа.
 *
 * Чанки и паузы подобраны так, чтобы фронтенд работал с потоком точно так же,
 * как с настоящим провайдером (см. docs/ai-integration-todo.md).
 */

export interface StreamTextOptions {
  thinkingMs: readonly [number, number];
  chunkMs: readonly [number, number];
  random: () => number;
  /** Проверяется перед каждым чанком: true — генерация прекращается. */
  isCancelled: () => boolean;
  onDelta: (chunk: string) => void;
  /** Подменяется в тестах, чтобы не ждать реальные паузы. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function randomBetween(range: readonly [number, number], random: () => number): number {
  const [min, max] = range;
  return min + random() * Math.max(0, max - min);
}

/** Режет текст на порции по 1-3 токена: ответ приходит «как настоящий». */
export function splitIntoChunks(text: string, random: () => number): string[] {
  const tokens = text.match(/\s+|\S+/g) ?? [];
  const chunks: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    const size = 1 + Math.floor(random() * 3);
    chunks.push(tokens.slice(index, index + size).join(''));
    index += size;
  }

  return chunks;
}

/** Отдаёт ответ порциями. Возвращает false, если генерацию остановили. */
export async function streamText(text: string, options: StreamTextOptions): Promise<boolean> {
  const sleep = options.sleep ?? delay;

  await sleep(randomBetween(options.thinkingMs, options.random));
  if (options.isCancelled()) {
    return false;
  }

  for (const chunk of splitIntoChunks(text, options.random)) {
    if (options.isCancelled()) {
      return false;
    }
    options.onDelta(chunk);
    await sleep(randomBetween(options.chunkMs, options.random));
  }

  return !options.isCancelled();
}
