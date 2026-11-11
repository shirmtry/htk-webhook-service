import { saveState } from '@/lib/db';
import { rotateSecret } from '@/lib/endpoints';
import { requireUser } from '@/lib/guard';
import { HttpError, route } from '@/lib/http';
import { enforceLimit } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await enforceLimit(`rotate:${user.id}`, 6, 60);
  const { id } = await ctx.params;
  const result = await rotateSecret(user.id, id);
  if (!result) throw new HttpError(404, 'not_found', 'Không tìm thấy endpoint.');
  await saveState();
  return Response.json({
    secret: result.secret,
    rotatedAt: result.endpoint.secret_rotated_at,
    graceHours: 24,
    endpoint: result.endpoint,
  });
});
