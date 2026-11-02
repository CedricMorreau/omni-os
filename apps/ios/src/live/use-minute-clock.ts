import { useEffect, useState } from 'react';

/** The time, refreshed every minute, so "5m" labels on screen keep up. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  return now;
}
