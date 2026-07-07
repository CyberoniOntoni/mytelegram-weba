/**
 * Same-origin Testgram web client transport.
 * The app is served from the same public host as the MTProto web gateway (via nginx/NPM proxy).
 */

export function isFamilyGramSelfHosted(): boolean {
  return process.env.FAMILYGRAM_SELF_HOSTED === '1';
}

export function getFamilyGramServerHost(): string {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }

  return process.env.FAMILYGRAM_SERVER_HOST || 'localhost';
}

export function getFamilyGramWebPort(): number {
  if (typeof window !== 'undefined' && window.location) {
    if (window.location.port) {
      return Number(window.location.port);
    }

    return window.location.protocol === 'https:' ? 443 : 80;
  }

  return Number(process.env.FAMILYGRAM_WEB_PORT || 443);
}

export function isFamilyGramWssPort(port: number): boolean {
  return port === 443 || port === 30443;
}

export function isFamilyGramHttpsPort(port: number): boolean {
  return port === 443 || port === 30443;
}