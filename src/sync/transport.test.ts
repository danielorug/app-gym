import { afterEach, describe, expect, it, vi } from 'vitest';
import { callApi, REQUEST_TIMEOUT_MS, SyncError } from './transport';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('callApi', () => {
  it('suelta una petición colgada (señal mala) y la marca como sin conexión', async () => {
    vi.useFakeTimers();
    // fetch que nunca contesta, pero respeta el abort como el real.
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const call = callApi({ url: 'https://script.google.com/macros/s/x/exec', token: 't' }, { action: 'ping' });
    const check = expect(call).rejects.toMatchObject({ kind: 'offline' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    await check;
    await call.catch((e) => expect(e).toBeInstanceOf(SyncError));
  });
});
