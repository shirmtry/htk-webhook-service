import { describe, expect, it } from 'vitest';
import { BACKOFF_SECONDS, backoffMs, formatDelay, isDue, nextStatus } from './backoff';

describe('backoff và jitter', () => {
  it('tăng theo lịch 10s, 30s, 2m, 5m, 15m', () => {
    expect(BACKOFF_SECONDS).toEqual([10, 30, 120, 300, 900]);
    expect(backoffMs(1, () => 0.5)).toBe(10_000);
    expect(backoffMs(2, () => 0.5)).toBe(30_000);
    expect(backoffMs(3, () => 0.5)).toBe(120_000);
    expect(backoffMs(4, () => 0.5)).toBe(300_000);
    expect(backoffMs(5, () => 0.5)).toBe(900_000);
  });

  it('jitter nằm trong ±20%', () => {
    expect(backoffMs(2, () => 0)).toBe(24_000);
    expect(backoffMs(2, () => 1)).toBe(36_000);
    expect(backoffMs(1, () => 0)).toBe(8_000);
    expect(backoffMs(1, () => 1)).toBe(12_000);
  });

  it('không vượt quá bậc cuối khi attempt lớn', () => {
    expect(backoffMs(9, () => 0.5)).toBe(900_000);
    expect(backoffMs(0, () => 0.5)).toBe(10_000);
  });

  it('chuyển DLQ khi chạm max_attempts', () => {
    expect(nextStatus(1, 5)).toBe('queued');
    expect(nextStatus(4, 5)).toBe('queued');
    expect(nextStatus(5, 5)).toBe('dlq');
    expect(nextStatus(6, 5)).toBe('dlq');
  });

  it('kiểm tra đến hạn và định dạng thời gian chờ', () => {
    const now = Date.parse('2026-11-11T06:00:00Z');
    expect(isDue(new Date(now - 1000).toISOString(), now)).toBe(true);
    expect(isDue(new Date(now + 1000).toISOString(), now)).toBe(false);
    expect(isDue('not-a-date', now)).toBe(false);
    expect(formatDelay(8_000)).toBe('8 giây');
    expect(formatDelay(120_000)).toBe('2 phút');
    expect(formatDelay(5_400_000)).toBe('1.5 giờ');
  });
});
