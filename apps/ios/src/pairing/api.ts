import type { AppPairingRedeemResponse, ServerCapabilities } from '@omni/shared/app-pairing.ts';

export const SUPPORTED_API_VERSION = 1;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export type PairingApiErrorKind =
  | 'invalid-input'
  | 'code-unavailable'
  | 'rate-limited'
  | 'unauthorized'
  | 'incompatible'
  | 'unreachable'
  | 'server-error';

export class PairingApiError extends Error {
  readonly kind: PairingApiErrorKind;
  readonly origin: string;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly api?: number;

  constructor(
    kind: PairingApiErrorKind,
    details: { origin: string; status?: number; retryAfterSeconds?: number; api?: number },
  ) {
    super(`Pairing request failed: ${kind}`);
    this.name = 'PairingApiError';
    this.kind = kind;
    this.origin = details.origin;
    if (details.status !== undefined) this.status = details.status;
    if (details.retryAfterSeconds !== undefined) this.retryAfterSeconds = details.retryAfterSeconds;
    if (details.api !== undefined) this.api = details.api;
  }
}

export interface PairingApi {
  redeemPairingCode(input: {
    origin: string;
    code: string;
    name: string;
  }): Promise<AppPairingRedeemResponse>;
  fetchCapabilities(input: { origin: string; token: string }): Promise<ServerCapabilities>;
  signOut(input: { origin: string; token: string }): Promise<void>;
}

export interface PairingApiOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface RequestInput {
  method: 'GET' | 'POST';
  path: string;
  token?: string;
  body?: unknown;
}

export function createPairingApi(options: PairingApiOptions = {}): PairingApi {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The timer covers the body read too, so a server that stalls mid-response is unreachable, not a hang.
  async function send<T>(
    origin: string,
    input: RequestInput,
    handle: (response: Response, text: string) => T,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const fetchImpl = options.fetch ?? globalThis.fetch;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (input.token !== undefined) headers.Authorization = `Bearer ${input.token}`;
      if (input.body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await fetchImpl(`${origin}${input.path}`, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
        redirect: 'error',
      });
      // React Native's fetch ignores `redirect`, so also check where the response came from.
      if (response.url !== '' && new URL(response.url).origin !== origin) {
        throw new PairingApiError('unreachable', { origin });
      }
      return handle(response, await response.text());
    } catch (error) {
      if (error instanceof PairingApiError) throw error;
      throw new PairingApiError('unreachable', { origin });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    redeemPairingCode({ origin, code, name }) {
      return send(
        origin,
        { method: 'POST', path: '/api/auth/app-pairings/redeem', body: { code, name } },
        (response, text) => {
          if (response.ok) {
            const body = parseJson(text);
            if (isRecord(body) && isNonEmptyString(body.token) && isNonEmptyString(body.sessionId)) {
              return { token: body.token, sessionId: body.sessionId };
            }
            throw new PairingApiError('server-error', { origin, status: response.status });
          }
          throw failureFor(origin, response, {
            400: 'invalid-input',
            404: 'code-unavailable',
            429: 'rate-limited',
          });
        },
      );
    },

    fetchCapabilities({ origin, token }) {
      return send(
        origin,
        { method: 'GET', path: '/api/capabilities', token },
        (response, text) => {
          if (!response.ok) {
            throw failureFor(origin, response, { 401: 'unauthorized', 404: 'incompatible' });
          }
          const body = parseJson(text);
          if (!isRecord(body)) throw new PairingApiError('incompatible', { origin });
          if (body.api !== SUPPORTED_API_VERSION) {
            const api = typeof body.api === 'number' ? body.api : undefined;
            throw new PairingApiError('incompatible', { origin, ...(api !== undefined && { api }) });
          }
          if (!hasCapabilitySections(body)) throw new PairingApiError('incompatible', { origin });
          return body as unknown as ServerCapabilities;
        },
      );
    },

    signOut({ origin, token }) {
      return send(origin, { method: 'POST', path: '/api/auth/signout', token }, (response) => {
        if (!response.ok) throw failureFor(origin, response, { 401: 'unauthorized' });
      });
    },
  };
}

function failureFor(
  origin: string,
  response: Response,
  byStatus: Partial<Record<number, PairingApiErrorKind>>,
): PairingApiError {
  const kind = byStatus[response.status] ?? 'server-error';
  return new PairingApiError(kind, {
    origin,
    status: response.status,
    ...(kind === 'rate-limited' && {
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
    }),
  });
}

function parseRetryAfter(header: string | null): number {
  if (header !== null && /^\d+$/.test(header.trim())) {
    const seconds = Number.parseInt(header, 10);
    if (seconds > 0) return seconds;
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function hasCapabilitySections(body: Record<string, unknown>): boolean {
  return ['auth', 'pairing', 'push', 'streams'].every((key) => isRecord(body[key]));
}
