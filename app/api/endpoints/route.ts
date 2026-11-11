import { z } from 'zod';
import { saveState } from '@/lib/db';
import { isBlockedTarget } from '@/lib/delivery';
import { createEndpoint, listEndpoints } from '@/lib/endpoints';
import { requireUser } from '@/lib/guard';
import { HttpError, readJson, route } from '@/lib/http';
import { enforceLimit } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  mode: z.enum(['sandbox', 'live']),
  targetUrl: z.string().trim().url().max(500),
  rateLimitPerMin: z.number().int().min(10).max(600).default(60),
});

export const GET = route(async () => {
  const user = await requireUser();
  const endpoints = await listEndpoints(user.id);
  return Response.json({ endpoints });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  await enforceLimit(`endpoint-create:${user.id}`, 10, 60);
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', 'Tên 2–60 ký tự, URL hợp lệ, rate limit 10–600 sự kiện/phút.');
  }
  if (parsed.data.mode === 'live') {
    const blocked = isBlockedTarget(parsed.data.targetUrl);
    if (blocked && process.env.ALLOW_PRIVATE_TARGETS !== '1') {
      throw new HttpError(400, 'blocked_target', blocked);
    }
    if (!parsed.data.targetUrl.startsWith('https://') && process.env.ALLOW_PRIVATE_TARGETS !== '1') {
      throw new HttpError(400, 'https_required', 'Endpoint live phải dùng https.');
    }
  }
  const endpoint = await createEndpoint(user.id, parsed.data);
  await saveState();
  return Response.json({ endpoint }, { status: 201 });
});
