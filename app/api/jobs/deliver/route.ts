import { processDueEvents } from '@/lib/delivery';
import { getUser } from '@/lib/auth';
import { HttpError, logEvent, route } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (cronAuthorized(req)) {
    const result = await processDueEvents(undefined, 50);
    logEvent('sweep', { scope: 'cron', ...result });
    return Response.json({ scope: 'all', ...result });
  }
  const user = await getUser();
  if (!user) throw new HttpError(401, 'unauthorized', 'Cần đăng nhập hoặc cron secret hợp lệ.');
  const result = await processDueEvents(user.id, 30);
  logEvent('sweep', { scope: user.id, ...result });
  return Response.json({ scope: 'user', ...result });
}

export const POST = route(run);

export const GET = route(async (req) => {
  if (!cronAuthorized(req)) throw new HttpError(401, 'unauthorized', 'Chỉ cron secret được gọi GET.');
  const result = await processDueEvents(undefined, 50);
  return Response.json({ scope: 'all', ...result });
});
