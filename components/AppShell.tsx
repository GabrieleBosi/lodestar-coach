import Link from "next/link";

import SignOutButton from "@/components/SignOutButton";

const tabs = [
  { href: "/app", label: "Chat" },
  { href: "/profile", label: "Profile" },
  { href: "/memories", label: "Memory" },
] as const;

/**
 * One shell for every authenticated route (issue #3, "Shell"). /app carried a
 * header and footer while /profile and /memories had neither — navigation was a
 * "← Back to chat" link pasted into each component. The shell owns brand, tabs,
 * sign-out and the disclaimer footer; pages own only their content.
 *
 * Below `sm` the tab row hides — ChatWorkspace's drawer carries the same links,
 * and the other pages remain reachable through it.
 */
export default function AppShell({
  userEmail,
  active,
  isAdmin = false,
  children,
}: {
  userEmail: string;
  active: "Chat" | "Metrics" | "Profile" | "Memory";
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const items = isAdmin
    ? [...tabs.slice(0, 1), { href: "/app/metrics", label: "Metrics" } as const, ...tabs.slice(1)]
    : tabs;
  return (
    <div className="flex h-dvh flex-col bg-ground text-ink">
      <header className="flex h-14 flex-none items-center gap-5 border-b border-line-faint px-5">
        <div className="mr-auto flex items-baseline gap-3">
          <Link href="/app" className="font-medium tracking-tight text-ink no-underline">
            Lodestar
          </Link>
          <span className="hidden font-mono text-[11px] text-ink-faint sm:inline">{userEmail}</span>
        </div>
        <nav className="flex items-center gap-4 sm:gap-[18px]">
          {items.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={t.label === active ? "page" : undefined}
              className={`hidden py-[17px] font-mono text-[12.5px] no-underline sm:block ${
                t.label === active
                  ? "border-b-2 border-accent pb-[15px] text-accent-ink"
                  : "text-ink-muted hover:text-accent-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
          <SignOutButton />
        </nav>
      </header>
      {children}
      <footer className="flex-none border-t border-line-faint px-5 py-2 text-center font-mono text-[10.5px] text-ink-faint">
        Lodestar provides general, evidence-based information and is{" "}
        <strong className="font-medium text-warn">NOT medical advice</strong>. Consult a qualified
        professional for individual circumstances.
      </footer>
    </div>
  );
}
