import { redirect } from 'next/navigation';
import { homeAreaFor } from '@/domain/auth/access';
import { getSessionUser } from '@/server/auth/session';
import { signOut } from '@/server/actions/auth';
import { Logo } from '@/ui/Logo';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const area = homeAreaFor(user.roles);
  if (area) redirect(`/${area}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <Logo />
      <h1 className="text-xl font-semibold">Your account is not set up yet</h1>
      <p className="text-fg-secondary">
        You are signed in, but no course or role has been assigned to this account. Please contact
        the school office.
      </p>
      <form action={signOut}>
        <button type="submit" className="font-medium text-primary hover:underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
