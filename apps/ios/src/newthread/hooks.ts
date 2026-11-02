import type { CreateThreadRequest, CrewRole, Thread } from '@omni/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLiveHub } from '../live/react';
import { attemptFor, newThreadId, startThread, type Attempt, type CreateFailure } from './draft';

/** Null while the roles load, and empty if the request fails. */
export function useCrew(): CrewRole[] | null {
  const hub = useLiveHub();
  const [crew, setCrew] = useState<CrewRole[] | null>(null);
  useEffect(() => {
    let live = true;
    hub
      .request((api) => api.crew())
      .then((roles) => live && setCrew(roles))
      .catch(() => live && setCrew([]));
    return () => {
      live = false;
    };
  }, [hub]);
  return crew;
}

export type StartState = { status: 'idle' } | { status: 'starting' } | { status: 'failed'; failure: CreateFailure };

const IDLE: StartState = { status: 'idle' };

/** One request is out at a time. A retry of the same request reuses its id (see attemptFor). */
export function useStartThread() {
  const hub = useLiveHub();
  const [state, setState] = useState<StartState>(IDLE);
  const attempt = useRef<Attempt | null>(null);
  const out = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(
    async (request: Omit<CreateThreadRequest, 'id'>): Promise<Thread | null> => {
      if (out.current) return null;
      out.current = true;
      setState({ status: 'starting' });
      attempt.current = attemptFor(attempt.current, request, newThreadId);
      const outcome = await startThread((body) => hub.request((api) => api.createThread(body)), { ...request, id: attempt.current.id });
      out.current = false;
      if (outcome.kind === 'created') {
        hub.applyThread(outcome.thread);
        return outcome.thread;
      }
      if (mounted.current) setState({ status: 'failed', failure: outcome.failure });
      return null;
    },
    [hub],
  );

  const dismiss = useCallback(() => setState((s) => (s.status === 'failed' ? IDLE : s)), []);
  return { state, start, dismiss };
}
