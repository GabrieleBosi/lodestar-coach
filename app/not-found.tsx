import Link from "next/link";

export const metadata = { title: "Page not found" };

/**
 * Any bad path — `/signin` among them — previously fell through to the unstyled
 * Next.js 404, which looks like the site is broken rather than the URL being
 * wrong (issue #2, P1). Structure and a way out; the design pass owns the look.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 bg-ground px-6 text-ink">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent-ink">
        404 — not found
      </p>
      <h1 className="text-2xl font-medium tracking-tight">This page doesn&apos;t exist</h1>
      <p className="text-sm text-ink-muted">
        The link may be out of date, or the address mistyped.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-medium no-underline hover:bg-ink/5"
        >
          Home
        </Link>
        <Link
          href="/demo"
          className="flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-medium no-underline hover:bg-ink/5"
        >
          Try the demo
        </Link>
        <Link
          href="/app"
          className="flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-medium no-underline hover:bg-ink/5"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
