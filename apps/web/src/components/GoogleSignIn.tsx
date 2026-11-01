import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api.ts';
import { Button, ErrorNote, LinkButton, Loader } from './ui.tsx';

// Google sign-in through Clerk's device-code flow (apps/server/google-auth.ts). The server asks Clerk for a code;
// this shows it and links to Clerk's page, where the person signs in with Google and approves; then it polls the
// server until Clerk answers. The pairing screen uses it to sign a new device in as the owner, and Settings,
// Machines to link the owner's account. A browser that signs in gets an HttpOnly cookie from the last poll and never
// holds the session itself.

interface FlowStart {
  flow: string;
  secret: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  interval: number;
}

type Poll =
  | { state: 'pending' }
  | { state: 'signed_in' }
  | { state: 'linked'; owner: { email: string | null } }
  | { state: 'refused'; error: string }
  | { state: 'denied' }
  | { state: 'expired' };

const ENDED: Record<'denied' | 'expired', string> = {
  denied: 'Sign-in was declined on the Clerk page.',
  expired: 'The code expired before it was approved. Start again.',
};

export function GoogleSignIn({
  mode,
  label,
  onDone,
}: {
  /** `device`: sign this browser in as the owner. `link`: make the account that approves the owner. */
  mode: 'device' | 'link';
  label: string;
  onDone: (r: Extract<Poll, { state: 'signed_in' | 'linked' }>) => void;
}) {
  const [flow, setFlow] = useState<FlowStart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!flow) return;
    let timer: ReturnType<typeof setTimeout>;
    let alive = true;
    const poll = async () => {
      try {
        const r = await api.post<Poll>('/auth/google/poll', { flow: flow.flow, secret: flow.secret });
        if (!alive) return;
        if (r.state === 'pending') timer = setTimeout(poll, flow.interval * 1000);
        else {
          setFlow(null);
          if (r.state === 'signed_in' || r.state === 'linked') done.current(r);
          else setError(r.state === 'refused' ? r.error : ENDED[r.state]);
        }
      } catch (err) {
        if (!alive) return;
        setFlow(null);
        setError(errorText(err));
      }
    };
    timer = setTimeout(poll, flow.interval * 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [flow]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setFlow(await api.post<FlowStart>(mode === 'device' ? '/auth/google/start' : '/auth/google/link', mode === 'device' ? { client: 'browser' } : {}));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (flow) {
    return (
      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <p className="text-[13px] text-fg-2">Open the sign-in page, choose Google, and check it shows this code before you approve.</p>
        <div className="font-mono text-[22px] tracking-[0.12em] text-fg" aria-label="Sign-in code">
          {flow.userCode}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={flow.verificationUriComplete ?? flow.verificationUri} target="_blank" variant="primary" icon="external">
            Open sign-in page
          </LinkButton>
          <Button variant="ghost" onClick={() => setFlow(null)}>
            Cancel
          </Button>
          <span className="ml-auto flex items-center gap-2 text-[12.5px] text-fg-3">
            <Loader size={12} /> Waiting for approval
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button variant={mode === 'device' ? 'primary' : 'secondary'} busy={busy} onClick={() => void start()}>
        {label}
      </Button>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
