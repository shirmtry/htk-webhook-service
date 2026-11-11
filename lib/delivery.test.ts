import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'htk-webhook-test-'));
process.env.PGLITE_DIR = dir;

let db: PGlite;
let endpointsApi: typeof import('./endpoints');
let deliveryApi: typeof import('./delivery');
let ingestApi: typeof import('./ingest');
let eventsApi: typeof import('./events');
let signApi: typeof import('./sign');

beforeAll(async () => {
  const dbModule = await import('./db');
  endpointsApi = await import('./endpoints');
  deliveryApi = await import('./delivery');
  ingestApi = await import('./ingest');
  eventsApi = await import('./events');
  signApi = await import('./sign');
  db = await dbModule.getDb();
});

afterAll(async () => {
  await db.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows can keep the WASM file handle briefly; the temp dir is disposable.
  }
});

async function makeEndpoint(name: string, overrides: Partial<{ rateLimitPerMin: number; maxAttempts: number }> = {}) {
  return endpointsApi.createEndpoint('u-demo', {
    name,
    targetUrl: 'https://target.example.com/hook',
    mode: 'sandbox',
    rateLimitPerMin: overrides.rateLimitPerMin ?? 600,
    maxAttempts: overrides.maxAttempts ?? 5,
  });
}

function headersFor(
  endpoint: { secret: string },
  body: string,
  key: string,
  eventType: string,
  opts: { secret?: string; timestamp?: number } = {},
): Headers {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  return new Headers({
    'content-type': 'application/json',
    'x-idempotency-key': key,
    'x-event-type': eventType,
    'x-htk-timestamp': String(timestamp),
    'x-htk-signature': signApi.signPayload(opts.secret ?? endpoint.secret, timestamp, body),
  });
}

describe('seed và số liệu', () => {
  it('seed 3 endpoint và 8 sự kiện', async () => {
    const endpoints = await db.query<{ n: number }>('select count(*)::int as n from endpoints');
    const events = await db.query<{ n: number }>('select count(*)::int as n from events');
    const deliveries = await db.query<{ n: number }>('select count(*)::int as n from deliveries');
    expect(Number(endpoints.rows[0].n)).toBe(3);
    expect(Number(events.rows[0].n)).toBe(8);
    expect(Number(deliveries.rows[0].n)).toBe(17);
  });

  it('tính success rate và p95 giao hàng theo user', async () => {
    const metrics = await eventsApi.getMetrics('u-demo');
    expect(metrics.endpoints).toBe(3);
    expect(metrics.activeEndpoints).toBe(2);
    expect(metrics.events).toBe(8);
    expect(metrics.delivered).toBe(3);
    expect(metrics.dlq).toBe(2);
    expect(metrics.queued).toBe(3);
    expect(metrics.successRate).toBe(60);
    expect(metrics.p95DeliveryMs).toBeGreaterThan(0);
    expect(metrics.byEndpoint).toHaveLength(3);

    await db.query("insert into users (id, email, name, password_hash) values ('u-other','other@htk.dev','Other','x')");
    const other = await eventsApi.getMetrics('u-other');
    expect(other.events).toBe(0);
    expect(other.successRate).toBeNull();
  });
});

describe('ingestion', () => {
  it('nhận sự kiện có chữ ký, chống trùng theo idempotency key', async () => {
    const endpoint = await makeEndpoint('Ingest happy');
    const body = JSON.stringify({ type: 'invoice.paid', id: 'inv_9' });
    const headers = headersFor(endpoint, body, 'key-happy-1', 'invoice.paid');
    const first = await ingestApi.ingestWebhook(endpoint, body, headers);
    expect(first.status).toBe(202);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.status).toBe('queued');
    expect(first.body.attempts).toBe(1);

    const duplicate = await ingestApi.ingestWebhook(endpoint, body, headers);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.event_id).toBe(first.body.event_id);
  });

  it('từ chối chữ ký sai, thiếu idempotency key và payload không phải object', async () => {
    const endpoint = await makeEndpoint('Ingest reject');
    const body = JSON.stringify({ type: 'ping' });

    const badSig = await ingestApi.ingestWebhook(
      endpoint,
      body,
      headersFor(endpoint, body, 'key-bad-sig', 'ping', { secret: 'whsec_wrong' }),
    );
    expect(badSig.status).toBe(401);

    const noKey = new Headers({
      'x-event-type': 'ping',
      'x-htk-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-htk-signature': signApi.signPayload(endpoint.secret, Math.floor(Date.now() / 1000), body),
    });
    const missing = await ingestApi.ingestWebhook(endpoint, body, noKey);
    expect(missing.status).toBe(400);
    expect((missing.body.error as { code: string }).code).toBe('missing_idempotency_key');

    const arrayBody = JSON.stringify([1, 2]);
    const arrayResult = await ingestApi.ingestWebhook(
      endpoint,
      arrayBody,
      headersFor(endpoint, arrayBody, 'key-array', 'ping'),
    );
    expect(arrayResult.status).toBe(400);
  });

  it('retry sandbox thất bại 2 lần rồi giao thành công ở lần 3', async () => {
    const endpoint = await makeEndpoint('Retry to success');
    const body = JSON.stringify({ type: 'order.created', id: 'ord_1' });
    const accepted = await ingestApi.ingestWebhook(
      endpoint,
      body,
      headersFor(endpoint, body, 'key-retry', 'order.created'),
    );
    expect(accepted.status).toBe(202);
    const eventId = String(accepted.body.event_id);

    const second = await deliveryApi.deliverEvent(eventId);
    expect(second?.event.status).toBe('queued');
    expect(second?.event.attempts).toBe(2);
    expect(second?.retryInMs).toBeGreaterThan(0);

    const third = await deliveryApi.deliverEvent(eventId);
    expect(third?.event.status).toBe('delivered');
    expect(third?.event.attempts).toBe(3);

    const deliveries = await eventsApi.getDeliveries(eventId);
    expect(deliveries.map((d) => d.outcome)).toEqual(['retry', 'retry', 'success']);
    expect(deliveries[2].status_code).toBe(200);
  });

  it('đưa sự kiện vào DLQ khi chạm max_attempts', async () => {
    const endpoint = await makeEndpoint('Dead letter', { maxAttempts: 2 });
    const body = JSON.stringify({ type: 'refund.failed' });
    const accepted = await ingestApi.ingestWebhook(
      endpoint,
      body,
      headersFor(endpoint, body, 'key-dlq', 'refund.failed'),
    );
    const eventId = String(accepted.body.event_id);
    const final = await deliveryApi.deliverEvent(eventId);
    expect(final?.event.status).toBe('dlq');
    expect(final?.retryInMs).toBeNull();
    const deliveries = await eventsApi.getDeliveries(eventId);
    expect(deliveries.map((d) => d.outcome)).toEqual(['retry', 'fatal']);
  });

  it('giới hạn số sự kiện mỗi phút theo endpoint', async () => {
    const endpoint = await makeEndpoint('Rate limited', { rateLimitPerMin: 2 });
    const body = JSON.stringify({ type: 'ping' });
    const one = await ingestApi.ingestWebhook(endpoint, body, headersFor(endpoint, body, 'rl-1', 'ping'));
    const two = await ingestApi.ingestWebhook(endpoint, body, headersFor(endpoint, body, 'rl-2', 'ping'));
    const three = await ingestApi.ingestWebhook(endpoint, body, headersFor(endpoint, body, 'rl-3', 'ping'));
    expect(one.status).toBe(202);
    expect(two.status).toBe(202);
    expect(three.status).toBe(429);
    expect(three.headers?.['retry-after']).toBeTruthy();
  });

  it('không nhận sự kiện khi endpoint tạm dừng', async () => {
    const endpoint = await makeEndpoint('Paused');
    await endpointsApi.updateEndpoint('u-demo', endpoint.id, { status: 'paused' });
    const paused = (await endpointsApi.getEndpoint('u-demo', endpoint.id))!;
    const body = JSON.stringify({ type: 'ping' });
    const result = await ingestApi.ingestWebhook(paused, body, headersFor(paused, body, 'paused-1', 'ping'));
    expect(result.status).toBe(409);
  });
});

describe('xoay secret', () => {
  it('secret cũ còn dùng được trong 24 giờ, sau đó bị từ chối', async () => {
    const endpoint = await makeEndpoint('Rotating');
    const oldSecret = endpoint.secret;
    const rotated = await endpointsApi.rotateSecret('u-demo', endpoint.id);
    expect(rotated?.secret).not.toBe(oldSecret);
    expect(rotated?.endpoint.previous_secret).toBe(oldSecret);

    const body = JSON.stringify({ type: 'rotate.test' });
    const grace = await ingestApi.ingestWebhook(
      rotated!.endpoint,
      body,
      headersFor(rotated!.endpoint, body, 'rot-1', 'rotate.test', { secret: oldSecret }),
    );
    expect(grace.status).toBe(202);

    await db.query("update endpoints set secret_rotated_at = now() - interval '25 hours' where id = $1", [
      endpoint.id,
    ]);
    const fresh = (await endpointsApi.getEndpoint('u-demo', endpoint.id))!;
    const expired = await ingestApi.ingestWebhook(
      fresh,
      body,
      headersFor(fresh, body, 'rot-2', 'rotate.test', { secret: oldSecret }),
    );
    expect(expired.status).toBe(401);

    const withNew = await ingestApi.ingestWebhook(
      fresh,
      body,
      headersFor(fresh, body, 'rot-3', 'rotate.test'),
    );
    expect(withNew.status).toBe(202);
  });
});

describe('replay và worker', () => {
  it('replay đưa sự kiện DLQ về hàng đợi và thử lại từ đầu', async () => {
    const before = await eventsApi.getDeliveries('evt_billing_canceled');
    expect(before).toHaveLength(5);
    const replayed = await deliveryApi.replayEvent('u-demo', 'evt_billing_canceled');
    expect(replayed?.event.attempts).toBe(1);
    expect(replayed?.event.status).toBe('queued');
    expect(replayed?.event.source).toBe('replay');
    const after = await eventsApi.getDeliveries('evt_billing_canceled');
    expect(after).toHaveLength(6);

    const denied = await deliveryApi.replayEvent('u-other', 'evt_billing_canceled');
    expect(denied).toBeNull();
  });

  it('quét sự kiện đến hạn, bỏ qua endpoint tạm dừng', async () => {
    const sweep = await deliveryApi.processDueEvents('u-demo');
    expect(sweep.processed).toBe(2);
    expect(sweep.delivered).toBe(1);
    expect(sweep.stillQueued).toBe(1);

    const paused = await db.query<{ attempts: number; status: string }>(
      "select attempts, status from events where id = 'evt_ocr_upload'",
    );
    expect(Number(paused.rows[0].attempts)).toBe(0);
    expect(paused.rows[0].status).toBe('queued');
  });
});

describe('chặn đích nội bộ', () => {
  it('chặn localhost, IP private và protocol lạ', () => {
    expect(deliveryApi.isBlockedTarget('http://127.0.0.1:3000/hook')).toBeTruthy();
    expect(deliveryApi.isBlockedTarget('http://10.0.0.5/hook')).toBeTruthy();
    expect(deliveryApi.isBlockedTarget('http://192.168.1.7/hook')).toBeTruthy();
    expect(deliveryApi.isBlockedTarget('http://169.254.1.1/hook')).toBeTruthy();
    expect(deliveryApi.isBlockedTarget('http://localhost/hook')).toBeTruthy();
    expect(deliveryApi.isBlockedTarget('ftp://example.com/hook')).toBeTruthy();
    expect(deliveryApi.isBlockedTarget('https://hooks.example.com/webhook')).toBeNull();
  });
});
