// No retries and no offline queue: a request that fails throws once, and the caller decides what to do next.
import { fetchUpload } from './upload.ts';

/** A server address `parseBaseUrl` accepted: http or https, a host, an optional path prefix, no trailing slash. */
export type BaseUrl = string & { readonly __brand: 'BaseUrl' };

/** A path under /api whose interpolated values are percent-encoded. Only `apiPath` makes one. */
export type ApiPath = string & { readonly __brand: 'ApiPath' };

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Query parameters, `undefined` ones left out. A string is a query already encoded, as `@omni/shared`'s builders make. */
export type Query = Readonly<Record<string, string | number | undefined>> | string;

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  /** Where the answer came from after any redirects. Empty or missing when the platform does not say. */
  url?: string;
  /** `opaqueredirect` is what a browser's fetch gives for a redirect it was told not to follow. */
  type?: string;
}

export type Fetch = (
  url: string,
  init: {
    method: HttpMethod;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    /** Always `manual`: a redirect is never followed, because the request may carry the bearer token. */
    redirect: 'manual';
  },
) => Promise<FetchResponse>;

/** A file on the device, as React Native's FormData takes it: the bytes stay where they are until the request reads them. */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

export interface UploadProgress {
  /** Bytes of the request body sent so far. */
  sent: number;
  /** The whole body's size, multipart framing included. */
  total: number;
}

/** What an upload sends: the JSON `payload` field and one `files` part per file, as `readBody` in the server reads them. */
export interface UploadInit {
  method: 'POST' | 'PATCH';
  headers: Record<string, string>;
  payload: string;
  files: readonly UploadFile[];
  signal?: AbortSignal;
  /** Called as the body goes out. A transport that cannot tell never calls it. */
  onProgress?: (progress: UploadProgress) => void;
  /** Always `manual`, as for `Fetch`. */
  redirect: 'manual';
}

/** Sends a multipart request. `fetchUpload` and `xhrUploadTransport` (upload.ts) are the two this package makes. */
export type UploadTransport = (url: string, init: UploadInit) => Promise<FetchResponse>;

export interface HttpClientConfig {
  baseUrl: BaseUrl;
  /** Sent as `Authorization: Bearer`. A function is read again on every request. */
  token: string | null | (() => string | null | Promise<string | null>);
  fetch?: Fetch;
  /** Sends uploads. Defaults to `fetchUpload` over `fetch`, which reports no progress. */
  upload?: UploadTransport;
  /** Gives up on a request, its body read included, after this long. The request then fails as `unreachable`. */
  timeoutMs?: number;
}

export interface RequestOptions<T> {
  query?: Query;
  /** Sent as JSON. Leave it out for a request with no body. */
  body?: unknown;
  signal?: AbortSignal;
  /** Turns the decoded JSON into `T`, throwing when it does not fit. Without it the JSON is trusted to be `T`. */
  parse?: (json: unknown) => T;
}

/** A multipart request: `payload` as JSON in its own field, then the files. */
export interface UploadOptions<T> extends Omit<RequestOptions<T>, 'body'> {
  payload: unknown;
  files: readonly UploadFile[];
  onProgress?: (progress: UploadProgress) => void;
}

/** Files to send with a call that takes a JSON body otherwise. With none, the call is the plain JSON request. */
export interface WithFiles {
  files: readonly UploadFile[];
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/** One call, JSON or multipart by whether there are files, so a caller has one path to retry. */
export function sendWithFiles<T>(http: HttpClient, method: 'POST', path: ApiPath, body: unknown, withFiles?: WithFiles): Promise<T> {
  if (!withFiles?.files.length) return http.request<T>(method, path, { body, signal: withFiles?.signal });
  return http.upload<T>(method, path, { payload: body, files: withFiles.files, onProgress: withFiles.onProgress, signal: withFiles.signal });
}

export type HttpFailure =
  /** No answer at all: the server is down, the address is wrong, or the connection dropped. */
  | { kind: 'unreachable'; detail: string }
  /** A non-2xx answer. `message` is the server's `{error}` or its text; `body` the parsed reply, for a 409's `code`. */
  | { kind: 'http'; status: number; message: string; body: unknown; retryAfter: string | null }
  /** A 2xx answer that is not JSON, like the Web UI's index.html for a path the server does not route. */
  | { kind: 'not-json'; status: number; contentType: string | null }
  /** JSON that does not parse, or that `parse` refused. */
  | { kind: 'decoding'; detail: string }
  | { kind: 'cancelled' }
  /** The server answered with a redirect, or the platform followed one to another origin. Refused: the token stays with the server. */
  | { kind: 'redirect' };

export class OmniHttpError extends Error {
  readonly failure: HttpFailure;
  constructor(failure: HttpFailure) {
    super(failureMessage(failure));
    this.name = 'OmniHttpError';
    this.failure = failure;
  }
}

function failureMessage(f: HttpFailure): string {
  switch (f.kind) {
    case 'unreachable':
      return 'Cannot reach the Omni server. Is it running?';
    case 'http':
      return f.message;
    case 'not-json':
      return `The server answered ${f.status} with ${f.contentType ?? 'no content type'}, not JSON.`;
    case 'decoding':
      return `The server sent data this app can't read: ${f.detail}`;
    case 'cancelled':
      return 'Cancelled.';
    case 'redirect':
      return 'The server redirected the request to another address. The app refuses to follow it.';
  }
}

/** The address a user typed or a pairing gave, or null when it is not an http(s) server address. */
export function parseBaseUrl(input: string): BaseUrl | null {
  const m = input.trim().match(/^(https?):\/\/([^/?#@\s]+)(\/[^?#\s]*)?$/i);
  if (!m) return null;
  return `${m[1].toLowerCase()}://${m[2]}${(m[3] ?? '').replace(/\/+$/, '')}` as BaseUrl;
}

/** `scheme://host[:port]` in lower case with a default port dropped, or null when `url` is not an absolute http(s) URL. */
export function originOf(url: string): string | null {
  const m = url.match(/^(https?):\/\/([^/?#\s]+)/i);
  if (!m || m[2].includes('@')) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase().replace(scheme === 'https' ? /:443$/ : /:80$/, '');
  return `${scheme}://${host}`;
}

/** Tag for API paths: apiPath`/threads/${id}/messages`. Each value is encoded, so an id with `/` or `?` stays one segment. */
export function apiPath(strings: TemplateStringsArray, ...values: (string | number)[]): ApiPath {
  const path = strings.reduce((out, s, i) => out + encodeURIComponent(String(values[i - 1])) + s);
  if (!path.startsWith('/')) throw new TypeError(`An API path starts with "/": ${path}`);
  return path as ApiPath;
}

function queryString(query: Query | undefined): string {
  if (query === undefined) return '';
  if (typeof query === 'string') return query.replace(/^\?/, '');
  return Object.entries(query)
    .flatMap(([k, v]) => (v === undefined ? [] : [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`]))
    .join('&');
}

const isJson = (contentType: string | null) => {
  const media = contentType?.split(';')[0].trim().toLowerCase();
  return media === 'application/json' || !!media?.endsWith('+json');
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

function errorMessage(data: unknown, contentType: string | null, status: number): string {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string' && (data as { error: string }).error) {
    return (data as { error: string }).error;
  }
  if (typeof data === 'string' && data && !contentType?.toLowerCase().startsWith('text/html')) return data.slice(0, 300);
  return `Request failed (${status})`;
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface HttpClient {
  readonly baseUrl: BaseUrl;
  /** The full URL of `path`, for the event streams and files that make their own requests. */
  url(path: ApiPath, query?: Query): string;
  /** Sends one request and resolves with its JSON body. Every failure rejects with an `OmniHttpError`. */
  request<T = unknown>(method: HttpMethod, path: ApiPath, options?: RequestOptions<T>): Promise<T>;
  /** Like `request`, with files. The same checks apply: no redirect is followed, and `signal` cancels it as `cancelled`. */
  upload<T = unknown>(method: 'POST' | 'PATCH', path: ApiPath, options: UploadOptions<T>): Promise<T>;
}

/**
 * A redirect is never followed. Where `fetch` honors `redirect: 'manual'` the redirect target is never contacted, so
 * the token cannot reach it. Where it does not (React Native's fetch ignores the option), the answer is still refused
 * when it did not come from the server's own origin, so nothing another origin sends is read.
 */
function redirected(res: FetchResponse, serverOrigin: string | null): boolean {
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return true;
  if (!res.url) return false;
  return originOf(res.url) !== serverOrigin;
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const send = config.fetch ?? (globalThis.fetch as unknown as Fetch);
  const sendUpload = config.upload ?? fetchUpload(send);
  const serverOrigin = originOf(config.baseUrl);

  const url = (path: ApiPath, query?: Query) => {
    const q = queryString(query);
    return `${config.baseUrl}/api${path}${q ? `?${q}` : ''}`;
  };

  type Call = (url: string, headers: Record<string, string>, signal: AbortSignal | undefined) => Promise<FetchResponse>;

  async function exchange<T>(path: ApiPath, options: Pick<RequestOptions<T>, 'query' | 'signal' | 'parse'>, call: Call): Promise<T> {
    const { signal, parse } = options;
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = typeof config.token === 'function' ? await config.token() : config.token;
    if (token?.trim()) headers.authorization = `Bearer ${token.trim()}`;

    // One controller covers the caller's signal and the timeout. The timer runs through the body read.
    const timeout = config.timeoutMs === undefined ? null : new AbortController();
    let timedOut = false;
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          timeout.abort();
        }, config.timeoutMs)
      : undefined;
    const onAbort = () => timeout?.abort();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort);

    let status: number;
    let contentType: string | null;
    let retryAfter: string | null;
    let text: string;
    try {
      const res = await call(url(path, options.query), headers, timeout ? timeout.signal : signal);
      if (redirected(res, serverOrigin)) throw new OmniHttpError({ kind: 'redirect' });
      status = res.status;
      contentType = res.headers.get('content-type');
      retryAfter = res.headers.get('retry-after');
      text = await res.text();
    } catch (err) {
      if (err instanceof OmniHttpError) throw err;
      if (timedOut) throw new OmniHttpError({ kind: 'unreachable', detail: 'timed out' });
      if (signal?.aborted || (err as { name?: unknown } | null)?.name === 'AbortError') throw new OmniHttpError({ kind: 'cancelled' });
      throw new OmniHttpError({ kind: 'unreachable', detail: describe(err) });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (status < 200 || status > 299) {
      const data = text ? parseJson(text) : null;
      throw new OmniHttpError({ kind: 'http', status, message: errorMessage(data, contentType, status), body: data, retryAfter });
    }
    if (!isJson(contentType)) throw new OmniHttpError({ kind: 'not-json', status, contentType });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new OmniHttpError({ kind: 'decoding', detail: describe(err) });
    }
    if (!parse) return json as T;
    try {
      return parse(json);
    } catch (err) {
      throw new OmniHttpError({ kind: 'decoding', detail: describe(err) });
    }
  }

  const request = <T>(method: HttpMethod, path: ApiPath, options: RequestOptions<T> = {}) =>
    exchange<T>(path, options, (target, headers, signal) => {
      const { body } = options;
      return send(target, {
        method,
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: 'manual',
      });
    });

  const upload = <T>(method: 'POST' | 'PATCH', path: ApiPath, options: UploadOptions<T>) =>
    exchange<T>(path, options, (target, headers, signal) =>
      sendUpload(target, { method, headers, payload: JSON.stringify(options.payload), files: options.files, signal, onProgress: options.onProgress, redirect: 'manual' }),
    );

  return { baseUrl: config.baseUrl, url, request, upload };
}
