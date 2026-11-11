import { getDeliveries, getEventForUser } from '@/lib/events';
import { requireUser } from '@/lib/guard';
import { HttpError, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const bundle = await getEventForUser(user.id, id);
  if (!bundle) throw new HttpError(404, 'not_found', 'Không tìm thấy sự kiện.');
  const deliveries = await getDeliveries(id);
  return Response.json({
    event: bundle.event,
    endpoint: {
      id: bundle.endpoint.id,
      name: bundle.endpoint.name,
      slug: bundle.endpoint.slug,
      mode: bundle.endpoint.mode,
      max_attempts: bundle.endpoint.max_attempts,
    },
    deliveries,
    now: new Date().toISOString(),
  });
});
