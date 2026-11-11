import { saveState } from '@/lib/db';
import { revealSecret } from '@/lib/endpoints';
import { requireUser } from '@/lib/guard';
import { HttpError, route } from '@/lib/http';
import { enforceLimit } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await enforceLimit(`reveal:${user.id}`, 20, 60);
  const { id } = await ctx.params;
  const secret = await revealSecret(user.id, id);
  if (!secret) throw new HttpError(404, 'not_found', 'Không tìm thấy endpoint.');
  await saveState();
  return Response.json({ secret });
});
