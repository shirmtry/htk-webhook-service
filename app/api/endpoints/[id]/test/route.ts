import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { saveState } from '@/lib/db';
import { deliverEvent } from '@/lib/delivery';
import { getEndpoint } from '@/lib/endpoints';
import { createEvent } from '@/lib/events';
import { requireUser } from '@/lib/guard';
import { HttpError, readJson, route } from '@/lib/http';
import { enforceLimit } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  eventType: z.string().trim().min(2).max(80),
  payload: z.record(z.string(), z.unknown()),
});

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  await enforceLimit(`test-event:${user.id}`, 30, 60);
  const { id } = await ctx.params;
  const endpoint = await getEndpoint(user.id, id);
  if (!endpoint) throw new HttpError(404, 'not_found', 'Không tìm thấy endpoint.');
  if (endpoint.status !== 'active') throw new HttpError(409, 'endpoint_paused', 'Endpoint đang tạm dừng.');

  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new HttpError(400, 'invalid_input', 'Cần event type 2–80 ký tự và payload là JSON object.');

  const payload = JSON.stringify(parsed.data.payload);
  if (Buffer.byteLength(payload, 'utf8') > 256 * 1024) {
    throw new HttpError(413, 'payload_too_large', 'Payload vượt quá 256 KB.');
  }

  const created = await createEvent(endpoint, {
    idempotencyKey: `test-${randomUUID()}`,
    eventType: parsed.data.eventType,
    payload,
    source: 'test',
  });
  const delivery = await deliverEvent(created.event.id);
  await saveState();
  return Response.json(
    { event: delivery?.event ?? created.event, delivery: delivery?.delivery ?? null },
    { status: 201 },
  );
});
