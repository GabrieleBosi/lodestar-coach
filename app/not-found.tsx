import Link from "next/link";

export const metadata = { title: "Page not found" };

/**
 * Any bad path — `/signin` among them — previously fell through to the unstyled
 * Next.js 404, which looks like the site is broken rather than the URL being
 * wrong (issue #2, P1). Structure and a way out; the design pass owns the look.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-stone-500">404</p>
      <h1 className="text-2xl font-bold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        The link may be out of date, or the address mistyped.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          Home
        </Link>
        <Link
          href="/demo"
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          Try the demo
        </Link>
        <Link
          href="/app"
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
