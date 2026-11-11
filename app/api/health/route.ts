import { getDb, usingBlob } from '@/lib/db';
import { route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const db = await getDb();
  const endpoints = await db.query<{ n: number }>('select count(*)::int as n from endpoints');
  const events = await db.query<{ n: number }>('select count(*)::int as n from events');
  return Response.json({
    ok: true,
    service: 'htk-webhook-service',
    db: 'ok',
    persistence: usingBlob() ? 'vercel-blob' : 'pglite-file',
    endpoints: Number(endpoints.rows[0]?.n ?? 0),
    events: Number(events.rows[0]?.n ?? 0),
    ts: new Date().toISOString(),
  });
});
