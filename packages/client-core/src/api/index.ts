// The wire shapes are copied here because this package imports neither the server nor the Web UI. Replies are cast to
// them, not validated. One file per domain: a domain owns its types and the calls that return them.
import type { HttpClient } from '../http.ts';
import { actionsApi } from './actions.ts';
import { activityApi } from './activity.ts';
import { channelsApi } from './channels.ts';
import { detailApi } from './detail.ts';
import { harnessesApi } from './harnesses.ts';
import { messagesApi } from './messages.ts';
import { needsYouApi } from './needs-you.ts';
import { recoveryApi } from './recovery.ts';
import { threadsApi } from './threads.ts';

export * from './actions.ts';
export * from './activity.ts';
export * from './channels.ts';
export * from './detail.ts';
export * from './events.ts';
export * from './harnesses.ts';
export * from './messages.ts';
export * from './needs-you.ts';
export * from './recovery.ts';
export * from './threads.ts';

export type OmniApi = ReturnType<typeof createOmniApi>;

export function createOmniApi(http: HttpClient) {
  return {
    ...channelsApi(http),
    ...threadsApi(http),
    ...detailApi(http),
    ...messagesApi(http),
    ...recoveryApi(http),
    ...needsYouApi(http),
    ...harnessesApi(http),
    ...activityApi(http),
    ...actionsApi(http),
  };
}
