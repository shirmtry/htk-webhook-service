import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-htk-signature';
export const TIMESTAMP_HEADER = 'x-htk-timestamp';
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';
export const TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, timestamp: string | number, rawBody: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `sha256=${mac}`;
}

export type VerifyInput = {
  secret: string;
  previousSecret?: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
  toleranceSeconds?: number;
};

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'format' | 'timestamp' | 'mismatch' };

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifySignature(input: VerifyInput): VerifyResult {
  const tolerance = input.toleranceSeconds ?? TOLERANCE_SECONDS;
  if (!input.timestamp || !input.signature) return { ok: false, reason: 'missing' };
  const seconds = Number(input.timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'timestamp' };
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - seconds) > tolerance) return { ok: false, reason: 'timestamp' };
  if (!/^sha256=[0-9a-f]{64}$/.test(input.signature)) return { ok: false, reason: 'format' };

  const expected = signPayload(input.secret, input.timestamp, input.rawBody);
  if (safeEqual(expected, input.signature)) return { ok: true };
  if (input.previousSecret) {
    const previous = signPayload(input.previousSecret, input.timestamp, input.rawBody);
    if (safeEqual(previous, input.signature)) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}

export function newSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}
