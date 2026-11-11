import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import type { Endpoint } from './endpoints';

export type EventStatus = 'queued' | 'delivered' | 'dlq';
export type EventSource = 'ingest' | 'test' | 'replay';

export type WebhookEvent = {
  id: string;
  endpoint_id: string;
  idempotency_key: string;
  event_type: string;
  payload: string;
  status: EventStatus;
  source: EventSource;
  attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error: string | null;
  received_at: string;
  delivered_at: string | null;
};

export type Delivery = {
  id: string;
  event_id: string;
  attempt_no: number;
  outcome: 'success' | 'retry' | 'fatal';
  status_code: number | null;
  response_body: string | null;
  duration_ms: number;
  error: string | null;
  started_at: string;
};

export async function listEvents(
  endpointId: string,
  opts: { status?: EventStatus; limit?: number } = {},
): Promise<WebhookEvent[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  if (opts.status) {
    const result = await db.query<WebhookEvent>(
      'select * from events where endpoint_id = $1 and status = $2 order by received_at desc limit $3',
      [endpointId, opts.status, limit],
    );
    return result.rows;
  }
  const result = await db.query<WebhookEvent>(
    'select * from events where endpoint_id = $1 order by received_at desc limit $2',
    [endpointId, limit],
  );
  return result.rows;
}

export async function getEventForUser(
  userId: string,
  eventId: string,
): Promise<{ event: WebhookEvent; endpoint: Endpoint } | null> {
  const db = await getDb();
  const result = await db.query<WebhookEvent & { endpoint_name: string; endpoint_slug: string; mode: string }>(
    `select v.*, e.name as endpoint_name, e.slug as endpoint_slug, e.mode
     from events v join endpoints e on e.id = v.endpoint_id
     where v.id = $1 and e.user_id = $2`,
    [eventId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const endpointResult = await db.query<Endpoint>('select * from endpoints where id = $1', [row.endpoint_id]);
  return { event: row, endpoint: endpointResult.rows[0] };
}

export async function getDeliveries(eventId: string): Promise<Delivery[]> {
  const db = await getDb();
  const result = await db.query<Delivery>(
    'select * from deliveries where event_id = $1 order by attempt_no asc, started_at asc',
    [eventId],
  );
  return result.rows;
}

export type CreateEventResult = { event: WebhookEvent; duplicate: boolean };

export async function createEvent(
  endpoint: Endpoint,
  input: { idempotencyKey: string; eventType: string; payload: string; source: EventSource },
): Promise<CreateEventResult> {
  const db = await getDb();
  const id = `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const inserted = await db.query<WebhookEvent>(
    `insert into events (id, endpoint_id, idempotency_key, event_type, payload, source, next_attempt_at)
     values ($1,$2,$3,$4,$5,$6, now())
     on conflict (endpoint_id, idempotency_key) do nothing
     returning *`,
    [id, endpoint.id, input.idempotencyKey, input.eventType, input.payload, input.source],
  );
  if (inserted.rows[0]) return { event: inserted.rows[0], duplicate: false };
  const existing = await db.query<WebhookEvent>(
    'select * from events where endpoint_id = $1 and idempotency_key = $2',
    [endpoint.id, input.idempotencyKey],
  );
  return { event: existing.rows[0], duplicate: true };
}

export type EndpointMetrics = {
  events: number;
  delivered: number;
  dlq: number;
  queued: number;
  attempts: number;
  retries: number;
  successRate: number | null;
  p95DeliveryMs: number | null;
};

export type Metrics = {
  endpoints: number;
  activeEndpoints: number;
  events: number;
  delivered: number;
  dlq: number;
  queued: number;
  attempts: number;
  retries: number;
  successRate: number | null;
  p95DeliveryMs: number | null;
  requestP50: number | null;
  requestP95: number | null;
  byEndpoint: Array<{ id: string; name: string; delivered: number; dlq: number; queued: number }>;
};

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export async function getMetrics(userId: string): Promise<Metrics> {
  const db = await getDb();
  const endpointsResult = await db.query<{ id: string; name: string }>(
    'select id, name from endpoints where user_id = $1 order by created_at desc',
    [userId],
  );
  const endpoints = endpointsResult.rows;
  const activeResult = await db.query<{ count: number }>(
    "select count(*)::int as count from endpoints where user_id = $1 and status = 'active'",
    [userId],
  );
  const eventResult = await db.query<{
    events: number;
    delivered: number;
    dlq: number;
    queued: number;
    attempts: number;
  }>(
    `select
       count(*)::int as events,
       count(*) filter (where v.status = 'delivered')::int as delivered,
       count(*) filter (where v.status = 'dlq')::int as dlq,
       count(*) filter (where v.status = 'queued')::int as queued,
       coalesce(sum(v.attempts), 0)::int as attempts
     from events v join endpoints e on e.id = v.endpoint_id
     where e.user_id = $1`,
    [userId],
  );
  const retryResult = await db.query<{ retries: number }>(
    `select count(*) filter (where d.outcome in ('retry','fatal'))::int as retries
     from deliveries d join events v on v.id = d.event_id join endpoints e on e.id = v.endpoint_id
     where e.user_id = $1`,
    [userId],
  );
  const deliveryTimes = await db.query<{ duration_ms: number }>(
    `select d.duration_ms from deliveries d
     join events v on v.id = d.event_id join endpoints e on e.id = v.endpoint_id
     where e.user_id = $1 order by d.started_at desc limit 500`,
    [userId],
  );
  const requestTimes = await db.query<{ duration_ms: number }>(
    'select duration_ms from request_logs order by created_at desc limit 500',
  );
  const byEndpoint = await Promise.all(
    endpoints.map(async (endpoint) => {
      const counts = await db.query<{ delivered: number; dlq: number; queued: number }>(
        `select
           count(*) filter (where status = 'delivered')::int as delivered,
           count(*) filter (where status = 'dlq')::int as dlq,
           count(*) filter (where status = 'queued')::int as queued
         from events where endpoint_id = $1`,
        [endpoint.id],
      );
      return {
        id: endpoint.id,
        name: endpoint.name,
        delivered: Number(counts.rows[0]?.delivered ?? 0),
        dlq: Number(counts.rows[0]?.dlq ?? 0),
        queued: Number(counts.rows[0]?.queued ?? 0),
      };
    }),
  );

  const totals = eventResult.rows[0] ?? { events: 0, delivered: 0, dlq: 0, queued: 0, attempts: 0 };
  const settled = Number(totals.delivered) + Number(totals.dlq);
  const durations = deliveryTimes.rows.map((r) => Number(r.duration_ms));
  const requests = requestTimes.rows.map((r) => Number(r.duration_ms));

  return {
    endpoints: endpoints.length,
    activeEndpoints: Number(activeResult.rows[0]?.count ?? 0),
    events: Number(totals.events),
    delivered: Number(totals.delivered),
    dlq: Number(totals.dlq),
    queued: Number(totals.queued),
    attempts: Number(totals.attempts),
    retries: Number(retryResult.rows[0]?.retries ?? 0),
    successRate: settled > 0 ? Math.round((Number(totals.delivered) / settled) * 1000) / 10 : null,
    p95DeliveryMs: percentile(durations, 95),
    requestP50: percentile(requests, 50),
    requestP95: percentile(requests, 95),
    byEndpoint,
  };
}
