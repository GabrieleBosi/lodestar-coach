"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Root error boundary. Without one, an unhandled render error showed the
 * default Next.js error screen with no way back (issue #2, P1).
 *
 * `reset()` re-renders the segment, which is the right first move for a
 * transient failure; the links are the way out when it isn't transient.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what correlates this with the server log.
    console.error("Unhandled error", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        This page failed to load. Trying again often works — the error has been logged.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-stone-400">Reference: {error.digest}</p>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
