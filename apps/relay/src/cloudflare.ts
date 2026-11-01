// The Cloudflare API calls Omni Connect makes (docs/adr/0009-omni-connect.md): a remotely managed tunnel per machine,
// its ingress, and a proxied CNAME under CONNECT_ZONE. Every step looks for what an earlier, interrupted try made
// before it makes anything, so provisioning again repairs instead of duplicating.
import { RelayError } from './auth.ts';

export interface CloudflareConfig {
  token: string;
  accountId: string;
  zoneId: string;
  /** The zone's name, like omni-os.app: hostnames are one label under it. */
  zone: string;
}

export interface Tunnel {
  tunnelId: string;
  dnsRecordId: string;
  /** What cloudflared runs with (TUNNEL_TOKEN). */
  connectorToken: string;
}

const API = 'https://api.cloudflare.com/client/v4';

type Envelope<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] };

export class CloudflareApi {
  constructor(
    private readonly config: CloudflareConfig,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.config.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new RelayError(502, `Cannot reach Cloudflare (${(err as Error).message})`);
    }
    const env = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || !env?.success) {
      const why = env?.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${res.status}`;
      throw new RelayError(502, `Cloudflare refused ${method} ${path.split('?')[0]} (${why})`, 'cloudflare');
    }
    return env.result;
  }

  private get acct() {
    return `/accounts/${this.config.accountId}/cfd_tunnel`;
  }

  /** Make or repair the tunnel, its ingress to 127.0.0.1:<port> and its DNS record. */
  async provision(tunnelName: string, hostname: string, port: number, known: { tunnelId?: string | null } = {}): Promise<Tunnel> {
    let tunnelId = known.tunnelId ?? null;
    if (tunnelId) {
      const t = await this.call<{ id: string; deleted_at: string | null } | null>('GET', `${this.acct}/${tunnelId}`).catch(() => null);
      if (!t || t.deleted_at) tunnelId = null;
    }
    if (!tunnelId) {
      const found = await this.call<{ id: string }[]>('GET', `${this.acct}?name=${encodeURIComponent(tunnelName)}&is_deleted=false`);
      tunnelId = found[0]?.id ?? (await this.call<{ id: string }>('POST', this.acct, { name: tunnelName, config_src: 'cloudflare' })).id;
    }
    await this.call('PUT', `${this.acct}/${tunnelId}/configurations`, {
      config: { ingress: [{ hostname, service: `http://127.0.0.1:${port}` }, { service: 'http_status:404' }] },
    });
    const target = `${tunnelId}.cfargotunnel.com`;
    const zone = `/zones/${this.config.zoneId}/dns_records`;
    const [record] = await this.call<{ id: string; content: string }[]>('GET', `${zone}?type=CNAME&name=${encodeURIComponent(hostname)}`);
    let dnsRecordId: string;
    if (!record) dnsRecordId = (await this.call<{ id: string }>('POST', zone, { type: 'CNAME', name: hostname, content: target, proxied: true, comment: 'Omni Connect' })).id;
    else {
      dnsRecordId = record.id;
      if (record.content !== target) await this.call('PATCH', `${zone}/${record.id}`, { content: target, proxied: true });
    }
    const connectorToken = await this.call<string>('GET', `${this.acct}/${tunnelId}/token`);
    return { tunnelId, dnsRecordId, connectorToken };
  }

  /** Delete the DNS record and the tunnel. Already gone counts as done. */
  async remove(tunnelId: string | null, dnsRecordId: string | null) {
    const gone = (err: unknown) => {
      if (!(err instanceof RelayError) || !/HTTP 404|1003|81044|not found/i.test(err.message)) throw err;
    };
    if (dnsRecordId) await this.call('DELETE', `/zones/${this.config.zoneId}/dns_records/${dnsRecordId}`).catch(gone);
    if (tunnelId) await this.call('DELETE', `${this.acct}/${tunnelId}?cascade=true`).catch(gone);
  }
}

/** The machine's hostname: its name as a DNS label, and 6 hex of a hash so two machines with one name differ. */
export async function hostnameFor(zone: string, user: string, machineId: string, name: string): Promise<string> {
  const slug =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'omni';
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${user}\n${machineId}`)));
  const hex = [...digest.slice(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${slug}-${hex}.${zone}`;
}
