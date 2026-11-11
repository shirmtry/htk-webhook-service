import { redirect } from 'next/navigation';
import { Dashboard } from '@/components/Dashboard';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const user = await getUser();
  if (!user) redirect('/login');
  return <Dashboard user={user} />;
}
