import { apiPath, type HttpClient } from '../http.ts';

/** The part of GET /status a client needs before it offers a file. The rest is the dashboard's. */
export interface ServerStatus {
  /** The largest file the server accepts, in megabytes. Older servers leave it out. */
  maxUploadMb?: number;
}

export function statusApi(http: HttpClient) {
  return {
    serverStatus: () => http.request<ServerStatus>('GET', apiPath`/status`),
  };
}
