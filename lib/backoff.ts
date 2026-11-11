export const BACKOFF_SECONDS = [10, 30, 120, 300, 900];
export const JITTER_RATIO = 0.2;

export type EventStatus = 'queued' | 'delivered' | 'dlq';

/** Delay before the next attempt. `attemptNo` is the attempt that just failed (1-based). */
export function backoffMs(attemptNo: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(attemptNo, 1), BACKOFF_SECONDS.length) - 1;
  const base = BACKOFF_SECONDS[index] * 1000;
  const jitter = base * JITTER_RATIO;
  const offset = (random() * 2 - 1) * jitter;
  return Math.max(1000, Math.round(base + offset));
}

export function nextStatus(attempts: number, maxAttempts: number): EventStatus {
  return attempts >= maxAttempts ? 'dlq' : 'queued';
}

export function isDue(nextAttemptAt: string, nowMs: number = Date.now()): boolean {
  const due = new Date(nextAttemptAt).getTime();
  return Number.isFinite(due) && due <= nowMs;
}

export function formatDelay(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} giây`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} phút`;
  return `${(ms / 3_600_000).toFixed(1)} giờ`;
}
