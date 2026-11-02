export type RemoteView = 'loading' | 'error' | 'empty' | 'list';

export interface RemoteSnapshot {
  data: readonly unknown[] | null;
  error: string | null;
  loading: boolean;
}

/** What a list loaded from the server shows: a spinner, the failure, the empty message or the rows. */
export function remoteView({ data, error, loading }: RemoteSnapshot): RemoteView {
  if (data) return data.length ? 'list' : 'empty';
  if (loading || !error) return 'loading';
  return 'error';
}

/** The quiet line under a list whose refresh failed. Nothing while the refresh runs or when it worked. */
export function refreshNote({ data, error, loading }: RemoteSnapshot): string | null {
  return data && error && !loading ? 'Last refresh failed. Pull down to try again.' : null;
}
