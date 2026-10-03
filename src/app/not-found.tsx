import Link from 'next/link';
import { Logo } from '@/ui/Logo';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <Logo />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-fg-secondary">
        This page does not exist, or you do not have access to it.
      </p>
      <Link href="/" className="font-medium text-primary hover:underline">
        Go to your home page
      </Link>
    </main>
  );
}
