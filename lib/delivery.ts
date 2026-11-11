import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { backoffMs, nextStatus } from './backoff';
import { getDb, saveState } from './db';
import { audit, type Endpoint } from './endpoints';
import type { Delivery, WebhookEvent } from './events';
import { signPayload, SIGNATURE_HEADER } from './sign';

export type AttemptResult = {
  ok: boolean;
  statusCode: number;
  body: string;
  durationMs: number;
  error: string | null;
};

const PRIVATE_HOSTS = /^(localhost|.*\.local|.*\.internal)$/i;

export function isBlockedTarget(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'URL không hợp lệ.';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Chỉ hỗ trợ http/https.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTS.test(host)) return 'Không gửi tới host nội bộ.';
  const version = isIP(host);
  if (version === 4) {
    const parts = host.split('.').map(Number);
    if (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    ) {
      return 'Không gửi tới địa chỉ IP nội bộ.';
    }
  }
  if (version === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) {
    return 'Không gửi tới địa chỉ IPv6 nội bộ.';
  }
  if (!host.includes('.') && version === 0) return 'Host phải là tên miền đầy đủ.';
  return null;
}

export async function performAttempt(
  endpoint: Endpoint,
  event: WebhookEvent,
  attemptNo: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AttemptResult> {
  if (endpoint.mode === 'sandbox') {
    const failed = attemptNo < 3;
    return {
      ok: !failed,
      statusCode: failed ? 500 : 200,
      body: failed
        ? JSON.stringify({ ok: false, error: 'sandbox: upstream trả 500' })
        : JSON.stringify({ ok: true, event: event.id, attempt: attemptNo }),
      durationMs: 12 + attemptNo * 5,
      error: failed ? 'Sandbox mô phỏng upstream lỗi 500' : null,
    };
  }

  const blocked = isBlockedTarget(endpoint.target_url);
  if (blocked && process.env.ALLOW_PRIVATE_TARGETS !== '1') {
    return { ok: false, statusCode: 0, body: '', durationMs: 0, error: blocked };
  }

  const started = performance.now();
  try {
    const response = await fetchImpl(endpoint.target_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'htk-webhook-service/1.0',
        'x-htk-event-id': event.id,
        'x-htk-attempt': String(attemptNo),
        [SIGNATURE_HEADER]: signPayload(endpoint.secret, Math.floor(Date.now() / 1000), event.payload),
      },
      body: event.payload,
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text().catch(() => '');
    const durationMs = Math.round(performance.now() - started);
    const ok = response.status >= 200 && response.status < 300;
    return {
      ok,
      statusCode: response.status,
      body: text.slice(0, 2000),
      durationMs,
      error: ok ? null : `Upstream trả ${response.status}`,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    return {
      ok: false,
      statusCode: 0,
      body: '',
      durationMs,
      error: error instanceof Error ? error.message : 'Không kết nối được upstream',
    };
  }
}

export type DeliveryResult = {
  event: WebhookEvent;
  delivery: Delivery;
  retryInMs: number | null;
};

export async function deliverEvent(
  eventId: string,
  opts: { fetchImpl?: typeof fetch; nowMs?: number } = {},
): Promise<DeliveryResult | null> {
  const db = await getDb();
  const eventResult = await db.query<WebhookEvent>('select * from events where id = $1', [eventId]);
  const event = eventResult.rows[0];
  if (!event) return null;
  if (event.status === 'delivered') return null;

  const endpointResult = await db.query<Endpoint>('select * from endpoints where id = $1', [event.endpoint_id]);
  const endpoint = endpointResult.rows[0];
  if (!endpoint || endpoint.status !== 'active') return null;

  const attemptNo = Number(event.attempts) + 1;
  const outcome = await performAttempt(endpoint, event, attemptNo, opts.fetchImpl ?? fetch);
  const now = opts.nowMs ?? Date.now();
  const deliveryId = `dlv_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const inserted = await db.query<Delivery>(
    `insert into deliveries (id, event_id, attempt_no, outcome, status_code, response_body, duration_ms, error, started_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, to_timestamp($9::double precision / 1000.0)) returning *`,
    [
      deliveryId,
      event.id,
      attemptNo,
      outcome.ok ? 'success' : nextStatus(attemptNo, endpoint.max_attempts) === 'dlq' ? 'fatal' : 'retry',
      outcome.statusCode,
      outcome.body,
      outcome.durationMs,
      outcome.error,
      now,
    ],
  );

  let updated: WebhookEvent;
  let retryInMs: number | null = null;
  if (outcome.ok) {
    const result = await db.query<WebhookEvent>(
      `update events
       set status = 'delivered', attempts = $2, last_status_code = $3, last_error = null,
           delivered_at = to_timestamp($4::double precision / 1000.0), next_attempt_at = to_timestamp($4::double precision / 1000.0)
       where id = $1 returning *`,
      [event.id, attemptNo, outcome.statusCode, now],
    );
    updated = result.rows[0];
  } else {
    const status = nextStatus(attemptNo, endpoint.max_attempts);
    retryInMs = status === 'queued' ? backoffMs(attemptNo) : null;
    const nextAt = now + (retryInMs ?? 0);
    const result = await db.query<WebhookEvent>(
      `update events
       set status = $2, attempts = $3, last_status_code = $4, last_error = $5,
           next_attempt_at = to_timestamp($6::double precision / 1000.0)
       where id = $1 returning *`,
      [event.id, status, attemptNo, outcome.statusCode, outcome.error, nextAt],
    );
    updated = result.rows[0];
    if (status === 'dlq') {
      await audit(null, 'event.dead_lettered', event.id, `${event.event_type} sau ${attemptNo} lần thử`);
    }
  }

  return { event: updated, delivery: inserted.rows[0], retryInMs };
}

export async function replayEvent(userId: string, eventId: string): Promise<DeliveryResult | null> {
  const db = await getDb();
  const owned = await db.query<WebhookEvent>(
    `select v.* from events v join endpoints e on e.id = v.endpoint_id
     where v.id = $1 and e.user_id = $2`,
    [eventId, userId],
  );
  const event = owned.rows[0];
  if (!event) return null;
  await db.query(
    `update events
     set status = 'queued', attempts = 0, next_attempt_at = now(), delivered_at = null,
         source = 'replay', last_error = null
     where id = $1`,
    [eventId],
  );
  await audit(userId, 'event.replayed', eventId, event.event_type);
  const result = await deliverEvent(eventId);
  await saveState();
  return result;
}

export type SweepResult = {
  processed: number;
  delivered: number;
  stillQueued: number;
  deadLettered: number;
};

export async function processDueEvents(userId?: string, limit = 20): Promise<SweepResult> {
  const db = await getDb();
  const params: unknown[] = [];
  let scope = '';
  if (userId) {
    params.push(userId);
    scope = `and e.user_id = $${params.length}`;
  }
  params.push(limit);
  const due = await db.query<{ id: string }>(
    `select v.id from events v join endpoints e on e.id = v.endpoint_id
     where v.status = 'queued' and v.next_attempt_at <= now() and e.status = 'active' ${scope}
     order by v.next_attempt_at asc limit $${params.length}`,
    params,
  );
  const result: SweepResult = { processed: 0, delivered: 0, stillQueued: 0, deadLettered: 0 };
  for (const row of due.rows) {
    const delivery = await deliverEvent(row.id);
    if (!delivery) continue;
    result.processed += 1;
    if (delivery.event.status === 'delivered') result.delivered += 1;
    else if (delivery.event.status === 'dlq') result.deadLettered += 1;
    else result.stillQueued += 1;
  }
  if (result.processed > 0) await saveState();
  return result;
}
