import { redirect } from 'next/navigation';
import { EventDetail } from '@/components/EventDetail';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const { id } = await params;
  return <EventDetail eventId={id} />;
}
