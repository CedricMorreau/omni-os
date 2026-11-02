// No retries and no offline queue: a request that fails throws once, and the caller decides what to do next.

/** A server address `parseBaseUrl` accepted: http or https, a host, an optional path prefix, no trailing slash. */
export type BaseUrl = string & { readonly __brand: 'BaseUrl' };

/** A path under /api whose interpolated values are percent-encoded. Only `apiPath` makes one. */
export type ApiPath = string & { readonly __brand: 'ApiPath' };

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Query parameters, `undefined` ones left out. A string is a query already encoded, as `@omni/shared`'s builders make. */
export type Query = Readonly<Record<string, string | number | undefined>> | string;

export type Fetch = (
  url: string,
  init: { method: HttpMethod; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface HttpClientConfig {
  baseUrl: BaseUrl;
  /** Sent as `Authorization: Bearer`. A function is read again on every request. */
  token: string | null | (() => string | null | Promise<string | null>);
  fetch?: Fetch;
}

export interface RequestOptions<T> {
  query?: Query;
  /** Sent as JSON. Leave it out for a request with no body. */
  body?: unknown;
  signal?: AbortSignal;
  /** Turns the decoded JSON into `T`, throwing when it does not fit. Without it the JSON is trusted to be `T`. */
  parse?: (json: unknown) => T;
}

export type HttpFailure =
  /** No answer at all: the server is down, the address is wrong, or the connection dropped. */
  | { kind: 'unreachable'; detail: string }
  /** A non-2xx answer. `message` is the server's `{error}` or its text; `body` the parsed reply, for a 409's `code`. */
  | { kind: 'http'; status: number; message: string; body: unknown }
  /** A 2xx answer that is not JSON, like the Web UI's index.html for a path the server does not route. */
  | { kind: 'not-json'; status: number; contentType: string | null }
  /** JSON that does not parse, or that `parse` refused. */
  | { kind: 'decoding'; detail: string }
  | { kind: 'cancelled' };

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
  }
}

/** The address a user typed or a pairing gave, or null when it is not an http(s) server address. */
export function parseBaseUrl(input: string): BaseUrl | null {
  const m = input.trim().match(/^(https?):\/\/([^/?#@\s]+)(\/[^?#\s]*)?$/i);
  if (!m) return null;
  return `${m[1].toLowerCase()}://${m[2]}${(m[3] ?? '').replace(/\/+$/, '')}` as BaseUrl;
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
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const send = config.fetch ?? (globalThis.fetch as Fetch);

  const url = (path: ApiPath, query?: Query) => {
    const q = queryString(query);
    return `${config.baseUrl}/api${path}${q ? `?${q}` : ''}`;
  };

  async function request<T>(method: HttpMethod, path: ApiPath, options: RequestOptions<T> = {}): Promise<T> {
    const { body, signal, parse } = options;
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = typeof config.token === 'function' ? await config.token() : config.token;
    if (token?.trim()) headers.authorization = `Bearer ${token.trim()}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let status: number;
    let contentType: string | null;
    let text: string;
    try {
      const res = await send(url(path, options.query), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
      status = res.status;
      contentType = res.headers.get('content-type');
      text = await res.text();
    } catch (err) {
      if (signal?.aborted || (err as { name?: unknown } | null)?.name === 'AbortError') throw new OmniHttpError({ kind: 'cancelled' });
      throw new OmniHttpError({ kind: 'unreachable', detail: describe(err) });
    }

    if (status < 200 || status > 299) {
      const data = text ? parseJson(text) : null;
      throw new OmniHttpError({ kind: 'http', status, message: errorMessage(data, contentType, status), body: data });
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

  return { baseUrl: config.baseUrl, url, request };
}
