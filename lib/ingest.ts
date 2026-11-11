import { deliverEvent } from './delivery';
import type { Endpoint } from './endpoints';
import { createEvent, type WebhookEvent } from './events';
import { hitLimit } from './rate-limit';
import { IDEMPOTENCY_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from './sign';

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_EVENT_TYPE = 80;

export type IngestOutcome = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

function reject(status: number, code: string, message: string, headers?: Record<string, string>): IngestOutcome {
  return { status, body: { error: { code, message } }, headers };
}

export async function ingestWebhook(
  endpoint: Endpoint,
  rawBody: string,
  headers: Headers,
  opts: { nowMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<IngestOutcome> {
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return reject(413, 'payload_too_large', 'Body vượt quá 256 KB.');
  }
  if (endpoint.status !== 'active') {
    return reject(409, 'endpoint_paused', 'Endpoint đang tạm dừng, không nhận sự kiện.');
  }

  const limit = await hitLimit(`ingest:${endpoint.id}`, endpoint.rate_limit_per_min, 60);
  if (!limit.ok) {
    return reject(429, 'rate_limited', `Vượt ${endpoint.rate_limit_per_min} sự kiện/phút cho endpoint này.`, {
      'retry-after': String(limit.retryAfter),
    });
  }

  const nowMs = opts.nowMs ?? Date.now();
  const rotatedAt = endpoint.secret_rotated_at ? new Date(endpoint.secret_rotated_at).getTime() : 0;
  const previousSecret =
    endpoint.previous_secret && nowMs - rotatedAt < 24 * 60 * 60 * 1000 ? endpoint.previous_secret : null;
  const verified = verifySignature({
    secret: endpoint.secret,
    previousSecret,
    timestamp: headers.get(TIMESTAMP_HEADER),
    signature: headers.get(SIGNATURE_HEADER),
    rawBody,
    nowMs,
  });
  if (!verified.ok) {
    const message =
      verified.reason === 'timestamp'
        ? 'Timestamp lệch quá 5 phút hoặc không hợp lệ.'
        : verified.reason === 'missing'
          ? `Thiếu header ${TIMESTAMP_HEADER} / ${SIGNATURE_HEADER}.`
          : 'Chữ ký HMAC không khớp.';
    return reject(401, 'invalid_signature', message);
  }

  const idempotencyKey = headers.get(IDEMPOTENCY_HEADER)?.trim();
  if (!idempotencyKey || idempotencyKey.length > 120) {
    return reject(400, 'missing_idempotency_key', `Cần header ${IDEMPOTENCY_HEADER} (1–120 ký tự).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return reject(400, 'invalid_json', 'Body phải là JSON hợp lệ.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return reject(400, 'invalid_payload', 'Payload phải là JSON object.');
  }

  const headerType = headers.get('x-event-type')?.trim();
  const bodyType = typeof (parsed as { type?: unknown }).type === 'string' ? (parsed as { type: string }).type : '';
  const eventType = (headerType || bodyType).slice(0, MAX_EVENT_TYPE);
  if (!eventType) {
    return reject(400, 'missing_event_type', 'Cần header x-event-type hoặc trường "type" trong body.');
  }

  let event: WebhookEvent;
  let duplicate: boolean;
  try {
    const created = await createEvent(endpoint, {
      idempotencyKey,
      eventType,
      payload: rawBody,
      source: 'ingest',
    });
    event = created.event;
    duplicate = created.duplicate;
  } catch {
    return reject(500, 'ingest_failed', 'Không lưu được sự kiện.');
  }

  if (duplicate) {
    return {
      status: 200,
      body: { duplicate: true, event_id: event.id, status: event.status, attempts: event.attempts },
    };
  }

  const delivered = await deliverEvent(event.id, { fetchImpl: opts.fetchImpl, nowMs: opts.nowMs });
  return {
    status: 202,
    body: {
      duplicate: false,
      event_id: delivered?.event.id ?? event.id,
      status: delivered?.event.status ?? 'queued',
      attempts: delivered?.event.attempts ?? 0,
      retry_in_ms: delivered?.retryInMs ?? null,
    },
  };
}
