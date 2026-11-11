import { replayEvent } from '@/lib/delivery';
import { requireUser } from '@/lib/guard';
import { HttpError, route } from '@/lib/http';
import { enforceLimit } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await enforceLimit(`replay:${user.id}`, 20, 60);
  const { id } = await ctx.params;
  const result = await replayEvent(user.id, id);
  if (!result) throw new HttpError(404, 'not_found', 'Không tìm thấy sự kiện thuộc tài khoản này.');
  return Response.json({ event: result.event, delivery: result.delivery, retryInMs: result.retryInMs });
});
