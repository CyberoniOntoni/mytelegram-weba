/**
 * Same-origin Testgram web client transport.
 * The app is served from the same public host as the MTProto web gateway (via nginx/NPM proxy).
 *
 * GramJS runs in a Web Worker where `window` is undefined — the main thread passes
 * the page hostname/port via setFamilyGramWebTransport() before connecting.
 */

import { IS_FAMILYGRAM, PRODUCTION_HOSTNAME } from '../config';

let webTransportHost: string | undefined;
let webTransportPort: number | undefined;

export function isFamilyGramSelfHosted(): boolean {
  return process.env.FAMILYGRAM_SELF_HOSTED === '1';
}

export function setFamilyGramWebTransport(host: string, port: number) {
  webTransportHost = host;
  webTransportPort = port;
}

export function getFamilyGramWebTransportFromWindow(): { host: string; port: number } | undefined {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return undefined;
  }

  const { hostname, port, protocol } = window.location;

  return {
    host: hostname,
    port: port ? Number(port) : (protocol === 'https:' ? 443 : 80),
  };
}

export function getFamilyGramServerHost(): string {
  if (webTransportHost) {
    return webTransportHost;
  }

  const fromWindow = getFamilyGramWebTransportFromWindow();
  if (fromWindow) {
    return fromWindow.host;
  }

  if (IS_FAMILYGRAM && PRODUCTION_HOSTNAME) {
    return PRODUCTION_HOSTNAME;
  }

  return process.env.FAMILYGRAM_SERVER_HOST || 'localhost';
}

export function getFamilyGramWebPort(): number {
  if (webTransportPort) {
    return webTransportPort;
  }

  const fromWindow = getFamilyGramWebTransportFromWindow();
  if (fromWindow) {
    return fromWindow.port;
  }

  if (IS_FAMILYGRAM) {
    return 443;
  }

  return Number(process.env.FAMILYGRAM_WEB_PORT || 443);
}

export function isFamilyGramWssPort(port: number): boolean {
  return port === 443 || port === 30443;
}

export function isFamilyGramHttpsPort(port: number): boolean {
  return port === 443 || port === 30443;
}