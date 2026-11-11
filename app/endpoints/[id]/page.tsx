import { redirect } from 'next/navigation';
import { EndpointRoom } from '@/components/EndpointRoom';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function EndpointPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect('/login');
  const { id } = await params;
  return <EndpointRoom endpointId={id} />;
}
