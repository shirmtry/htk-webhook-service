import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './sign';

const secret = 'whsec_test_123';
const body = JSON.stringify({ type: 'invoice.paid', id: 'inv_1' });
const now = Date.parse('2026-11-11T06:00:00Z');
const ts = Math.floor(now / 1000);

describe('HMAC signature', () => {
  it('tạo chữ ký sha256 ổn định cho timestamp + body', () => {
    const signature = signPayload(secret, ts, body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signPayload(secret, ts, body)).toBe(signature);
    expect(signPayload(secret, ts, body + ' ')).not.toBe(signature);
  });

  it('chấp nhận chữ ký đúng trong cửa sổ 5 phút', () => {
    const result = verifySignature({
      secret,
      timestamp: String(ts),
      signature: signPayload(secret, ts, body),
      rawBody: body,
      nowMs: now,
    });
    expect(result).toEqual({ ok: true });
  });

  it('từ chối body bị sửa hoặc secret khác', () => {
    const signature = signPayload(secret, ts, body);
    expect(
      verifySignature({ secret, timestamp: String(ts), signature, rawBody: body + 'x', nowMs: now }),
    ).toEqual({ ok: false, reason: 'mismatch' });
    expect(
      verifySignature({ secret: 'whsec_other', timestamp: String(ts), signature, rawBody: body, nowMs: now }),
    ).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('từ chối timestamp lệch quá 300 giây', () => {
    const signature = signPayload(secret, ts, body);
    const result = verifySignature({
      secret,
      timestamp: String(ts),
      signature,
      rawBody: body,
      nowMs: now + 301_000,
    });
    expect(result).toEqual({ ok: false, reason: 'timestamp' });
  });

  it('báo thiếu header và sai định dạng chữ ký', () => {
    expect(verifySignature({ secret, timestamp: null, signature: null, rawBody: body })).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(
      verifySignature({ secret, timestamp: String(ts), signature: 'sha1=abc', rawBody: body, nowMs: now }),
    ).toEqual({ ok: false, reason: 'format' });
    expect(
      verifySignature({ secret, timestamp: 'abc', signature: signPayload(secret, ts, body), rawBody: body, nowMs: now }),
    ).toEqual({ ok: false, reason: 'timestamp' });
  });

  it('chấp nhận secret cũ trong giai đoạn chuyển tiếp', () => {
    const oldSecret = 'whsec_old_456';
    const signature = signPayload(oldSecret, ts, body);
    expect(
      verifySignature({
        secret,
        previousSecret: oldSecret,
        timestamp: String(ts),
        signature,
        rawBody: body,
        nowMs: now,
      }),
    ).toEqual({ ok: true });
  });
});
