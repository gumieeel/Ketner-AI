export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Разбирает один блок SSE (текст между пустыми строками).
 *
 * Возвращает null, если данных в блоке нет: комментарии и «сердцебиения»
 * сервера нас не интересуют.
 */
export function parseSseBlock(block: string): SseEvent | null {
  let event = 'message';
  const data: string[] = [];

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }

  if (data.length === 0) {
    return null;
  }
  return { event, data: data.join('\n') };
}

/**
 * Читает поток SSE и отдаёт готовые события.
 *
 * Буфер хранит «хвост» без завершающей пустой строки: сеть может разорвать
 * событие посередине, и склеивать его должен клиент, а не сервер.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';
    for (const block of blocks) {
      const event = parseSseBlock(block);
      if (event) {
        onEvent(event);
      }
    }
  }

  const tail = parseSseBlock(buffer);
  if (tail) {
    onEvent(tail);
  }
}
