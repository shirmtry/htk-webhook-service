import { z } from 'zod';
import { getDb, saveState } from '@/lib/db';
import { getEndpoint, updateEndpoint } from '@/lib/endpoints';
import { listEvents } from '@/lib/events';
import { requireUser } from '@/lib/guard';
import { HttpError, readJson, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  rateLimitPerMin: z.number().int().min(10).max(600).optional(),
});

export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const endpoint = await getEndpoint(user.id, id);
  if (!endpoint) throw new HttpError(404, 'not_found', 'Không tìm thấy endpoint.');
  const events = await listEvents(id, { limit: 30 });
  const db = await getDb();
  const durations = await db.query<{ duration_ms: number }>(
    `select d.duration_ms from deliveries d join events v on v.id = d.event_id
     where v.endpoint_id = $1 order by d.started_at desc limit 200`,
    [id],
  );
  const sorted = durations.rows.map((r) => Number(r.duration_ms)).sort((a, b) => a - b);
  const settled = Number(endpoint.delivered) + Number(endpoint.dlq);
  return Response.json({
    endpoint,
    events,
    metrics: {
      delivered: Number(endpoint.delivered),
      dlq: Number(endpoint.dlq),
      queued: Number(endpoint.queued),
      attempts: Number(endpoint.attempts),
      successRate: settled > 0 ? Math.round((Number(endpoint.delivered) / settled) * 1000) / 10 : null,
      p95DeliveryMs: sorted.length > 0 ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
    },
    ingestUrl: `${new URL(req.url).origin}/api/ingest/${endpoint.slug}`,
    now: new Date().toISOString(),
  });
});

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', 'Chỉ hỗ trợ đổi trạng thái và rate limit 10–600/phút.');
  }
  const endpoint = await updateEndpoint(user.id, id, parsed.data);
  if (!endpoint) throw new HttpError(404, 'not_found', 'Không tìm thấy endpoint.');
  await saveState();
  return Response.json({ endpoint });
});
