import type { Response } from 'express';

/** Как часто в поток уходит комментарий-«сердцебиение»: прокси не рвёт долгое молчание модели. */
const HEARTBEAT_MS = 15_000;

export interface SseChannel {
  write: (event: string, payload: unknown) => void;
  /** Срабатывает, когда клиент закрыл соединение (вкладка, кнопка «Стоп»). */
  signal: AbortSignal;
  /** Закрывает поток: снимает сердцебиение и обработчик закрытия. */
  end: () => void;
}

/** Открывает поток SSE с сердцебиением; закрытое клиентом соединение отменяет работу. */
export function openSse(response: Response): SseChannel {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();

  const abort = new AbortController();
  const onClose = (): void => {
    if (!response.writableEnded) abort.abort();
  };
  response.on('close', onClose);
  const heartbeat = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write(': ping\n\n');
  }, HEARTBEAT_MS);

  return {
    signal: abort.signal,
    write: (event, payload) => {
      if (response.writableEnded || response.destroyed) return;
      response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    },
    end: () => {
      clearInterval(heartbeat);
      response.off('close', onClose);
      if (!response.writableEnded) response.end();
    },
  };
}
