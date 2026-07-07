import { getFamilyGramWebTransportFromWindow } from './familygramServer';

export type FamilyGramWsProbeResult = 'ok' | 'failed' | 'timeout';

export function getFamilyGramWebSocketUrl(): string | undefined {
  const transport = getFamilyGramWebTransportFromWindow();
  if (!transport) return undefined;

  const { host, port } = transport;
  const authority = (port === 443 || port === 80) ? host : `${host}:${port}`;
  const suffix = '/apiws';

  if (port === 443 || port === 30443) {
    return `wss://${authority}${suffix}`;
  }

  return `ws://${authority}${suffix}`;
}

export function probeFamilyGramWebSocket(timeoutMs = 6000): Promise<FamilyGramWsProbeResult> {
  const url = getFamilyGramWebSocketUrl();
  if (!url) return Promise.resolve('failed');

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: FamilyGramWsProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const ws = new WebSocket(url, 'binary');
    const timer = setTimeout(() => {
      ws.close();
      finish('timeout');
    }, timeoutMs);

    ws.onopen = () => {
      ws.close();
      finish('ok');
    };

    ws.onerror = () => {
      finish('failed');
    };
  });
}