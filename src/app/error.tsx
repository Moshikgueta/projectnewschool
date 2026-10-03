'use client';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Never show error details to users; they go to error monitoring (Sentry, Phase 1 follow-up).
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-fg-secondary">The page could not be loaded. Try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        className="self-start font-medium text-primary hover:underline"
      >
        Try again
      </button>
    </main>
  );
}
