export type EventStatus = 'queued' | 'delivered' | 'dlq';

export const STATUS_META: Record<EventStatus, { label: string; className: string }> = {
  queued: { label: 'Đang chờ', className: 'border-amber-400/40 bg-amber-400/10 text-amber-200' },
  delivered: { label: 'Đã giao', className: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' },
  dlq: { label: 'DLQ', className: 'border-rose-500/40 bg-rose-500/10 text-rose-200' },
};

export const OUTCOME_META: Record<string, { label: string; className: string }> = {
  success: { label: 'Thành công', className: 'text-emerald-300' },
  retry: { label: 'Thử lại', className: 'text-amber-300' },
  fatal: { label: 'Bỏ cuộc', className: 'text-rose-300' },
};

export function relative(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const diff = nowMs - then;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  let value: string;
  if (abs < 45_000) value = 'vài giây';
  else if (minutes < 60) value = `${minutes} phút`;
  else if (minutes < 1440) value = `${Math.round(minutes / 60)} giờ`;
  else value = `${Math.round(minutes / 1440)} ngày`;
  return future ? `${value} nữa` : `${value} trước`;
}

export function timeShort(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function truncate(value: string | null, max = 140): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function formatMs(ms: number | null): string {
  if (ms === null) return 'chưa đo';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
