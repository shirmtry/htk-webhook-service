import { getMetrics } from '@/lib/events';
import { requireUser } from '@/lib/guard';
import { route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await requireUser();
  const metrics = await getMetrics(user.id);
  return Response.json({ metrics, now: new Date().toISOString() });
});
