import { apiPath, type HttpClient } from '../http.ts';

/** A device signed in to the server: a browser with Google, or an app that paired. */
export interface SignedInDevice {
  id: string;
  name: string;
  kind: 'browser' | 'app';
  createdAt: string;
  lastSeenAt: string;
  /** The device that asked. */
  current: boolean;
}

export function accountApi(http: HttpClient) {
  return {
    /** The signed-in devices, most recently used first. Empty until the server has an owner. */
    devices: async () => (await http.request<{ devices: SignedInDevice[] }>('GET', apiPath`/auth/devices`)).devices,
    /** Ends one device's session. A paired app can end only its own. */
    revokeDevice: (id: string) => http.request<{ ok: true }>('DELETE', apiPath`/auth/devices/${id}`),
  };
}
