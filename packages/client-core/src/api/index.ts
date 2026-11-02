// The wire shapes are copied here because this package imports neither the server nor the Web UI. Replies are cast to
// them, not validated. One file per domain: a domain owns its types and the calls that return them.
import type { HttpClient } from '../http.ts';
import { channelsApi } from './channels.ts';
import { crewApi } from './crew.ts';
import { detailApi } from './detail.ts';
import { harnessesApi } from './harnesses.ts';
import { messagesApi } from './messages.ts';
import { needsYouApi } from './needs-you.ts';
import { recoveryApi } from './recovery.ts';
import { statusApi } from './status.ts';
import { threadsApi } from './threads.ts';

export * from './channels.ts';
export * from './crew.ts';
export * from './detail.ts';
export * from './events.ts';
export * from './harnesses.ts';
export * from './messages.ts';
export * from './needs-you.ts';
export * from './recovery.ts';
export * from './status.ts';
export * from './threads.ts';

export type OmniApi = ReturnType<typeof createOmniApi>;

export function createOmniApi(http: HttpClient) {
  return {
    ...channelsApi(http),
    ...crewApi(http),
    ...threadsApi(http),
    ...detailApi(http),
    ...messagesApi(http),
    ...recoveryApi(http),
    ...needsYouApi(http),
    ...harnessesApi(http),
    ...statusApi(http),
  };
}
