import { randomBytes, randomUUID } from 'node:crypto';
import { getDb } from './db';
import { newSecret } from './sign';

export type EndpointMode = 'sandbox' | 'live';
export type EndpointStatus = 'active' | 'paused';

export type Endpoint = {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  target_url: string;
  mode: EndpointMode;
  secret: string;
  previous_secret: string | null;
  secret_rotated_at: string | null;
  rate_limit_per_min: number;
  max_attempts: number;
  status: EndpointStatus;
  created_at: string;
  updated_at: string;
};

export type EndpointWithStats = Endpoint & {
  delivered: number;
  dlq: number;
  queued: number;
  attempts: number;
  last_event_at: string | null;
};

const SELECT = `
  select e.*,
    coalesce((select count(*) from events v where v.endpoint_id = e.id and v.status = 'delivered'), 0)::int as delivered,
    coalesce((select count(*) from events v where v.endpoint_id = e.id and v.status = 'dlq'), 0)::int as dlq,
    coalesce((select count(*) from events v where v.endpoint_id = e.id and v.status = 'queued'), 0)::int as queued,
    coalesce((select coalesce(sum(v.attempts), 0) from events v where v.endpoint_id = e.id), 0)::int as attempts,
    (select max(v.received_at) from events v where v.endpoint_id = e.id) as last_event_at
  from endpoints e
`;

export async function listEndpoints(userId: string): Promise<EndpointWithStats[]> {
  const db = await getDb();
  const result = await db.query<EndpointWithStats>(`${SELECT} where e.user_id = $1 order by e.created_at desc`, [
    userId,
  ]);
  return result.rows;
}

export async function getEndpoint(userId: string, id: string): Promise<EndpointWithStats | null> {
  const db = await getDb();
  const result = await db.query<EndpointWithStats>(`${SELECT} where e.user_id = $1 and e.id = $2`, [userId, id]);
  return result.rows[0] ?? null;
}

export async function getEndpointBySlug(slug: string): Promise<Endpoint | null> {
  const db = await getDb();
  const result = await db.query<Endpoint>('select * from endpoints where slug = $1', [slug]);
  return result.rows[0] ?? null;
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  const suffix = randomBytes(2).toString('hex');
  return `${base || 'endpoint'}-${suffix}`;
}

export async function audit(
  actorId: string | null,
  action: string,
  target: string,
  detail?: string,
): Promise<void> {
  const db = await getDb();
  await db.query('insert into audit_logs (id, actor_id, action, target, detail) values ($1,$2,$3,$4,$5)', [
    randomUUID(),
    actorId,
    action,
    target,
    detail ?? null,
  ]);
}

export type CreateEndpointInput = {
  name: string;
  targetUrl: string;
  mode: EndpointMode;
  rateLimitPerMin: number;
  maxAttempts?: number;
};

export async function createEndpoint(userId: string, input: CreateEndpointInput): Promise<Endpoint> {
  const db = await getDb();
  const id = `ep_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const result = await db.query<Endpoint>(
    `insert into endpoints (id, user_id, slug, name, target_url, mode, secret, rate_limit_per_min, max_attempts)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [
      id,
      userId,
      slugify(input.name),
      input.name,
      input.targetUrl,
      input.mode,
      newSecret(),
      input.rateLimitPerMin,
      input.maxAttempts ?? 5,
    ],
  );
  const endpoint = result.rows[0];
  await audit(userId, 'endpoint.created', endpoint.id, `${endpoint.name} (${endpoint.mode})`);
  return endpoint;
}

export async function updateEndpoint(
  userId: string,
  id: string,
  patch: { status?: EndpointStatus; rateLimitPerMin?: number },
): Promise<Endpoint | null> {
  const db = await getDb();
  const current = await getEndpoint(userId, id);
  if (!current) return null;
  const status = patch.status ?? current.status;
  const rate = patch.rateLimitPerMin ?? current.rate_limit_per_min;
  const result = await db.query<Endpoint>(
    'update endpoints set status = $3, rate_limit_per_min = $4, updated_at = now() where user_id = $1 and id = $2 returning *',
    [userId, id, status, rate],
  );
  const changed = [
    patch.status && patch.status !== current.status ? `status=${status}` : null,
    patch.rateLimitPerMin && patch.rateLimitPerMin !== current.rate_limit_per_min ? `rate=${rate}/phút` : null,
  ].filter(Boolean);
  if (changed.length > 0) await audit(userId, 'endpoint.updated', id, changed.join(', '));
  return result.rows[0] ?? null;
}

export type RotateResult = { endpoint: Endpoint; secret: string };

export async function rotateSecret(userId: string, id: string): Promise<RotateResult | null> {
  const db = await getDb();
  const secret = newSecret();
  const result = await db.query<Endpoint>(
    `update endpoints
     set previous_secret = secret, secret = $3, secret_rotated_at = now(), updated_at = now()
     where user_id = $1 and id = $2 returning *`,
    [userId, id, secret],
  );
  const endpoint = result.rows[0];
  if (!endpoint) return null;
  await audit(userId, 'endpoint.secret_rotated', id, 'Secret cũ còn hiệu lực 24 giờ để chuyển tiếp');
  return { endpoint, secret };
}

export async function revealSecret(userId: string, id: string): Promise<string | null> {
  const endpoint = await getEndpoint(userId, id);
  if (!endpoint) return null;
  await audit(userId, 'endpoint.secret_revealed', id);
  return endpoint.secret;
}
