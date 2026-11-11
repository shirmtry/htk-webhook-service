import { saveState } from '@/lib/db';
import { getEndpointBySlug } from '@/lib/endpoints';
import { ingestWebhook, MAX_BODY_BYTES } from '@/lib/ingest';
import { fail, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async (req, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const endpoint = await getEndpointBySlug(slug);
  if (!endpoint) return fail(404, 'not_found', 'Endpoint không tồn tại.');

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(413, 'payload_too_large', 'Body vượt quá 256 KB.');

  const rawBody = await req.text();
  const result = await ingestWebhook(endpoint, rawBody, req.headers);
  if (result.status === 202) await saveState();
  return Response.json(result.body, { status: result.status, headers: result.headers });
});
