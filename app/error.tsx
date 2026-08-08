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
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 bg-ground px-6 text-ink">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-warn">
        Something went wrong
      </p>
      <h1 className="text-2xl font-medium tracking-tight">This page failed to load</h1>
      <p className="text-sm text-ink-muted">
        Trying again often works — the error has been logged.
      </p>
      {error.digest && (
        <p>
          <span className="inline-block rounded border border-line px-2.5 py-1 font-mono text-[11px] text-ink-muted">
            Reference: {error.digest}
          </span>
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 rounded-lg border border-accent px-5 text-sm font-medium text-accent hover:bg-accent-wash"
        >
          Try again
        </button>
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-medium no-underline hover:bg-ink/5"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
