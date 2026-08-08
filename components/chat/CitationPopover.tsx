/**
 * Hover/focus popover for a resolved citation marker (issue #3, D-4).
 *
 * Presentational only: shown purely via `group-hover/cite` and
 * `group-focus-within/cite` on the marker's wrapper, so touch gets the
 * two-tap pattern for free — first tap focuses the anchor (popover shows),
 * second tap activates the link. No JS, no state.
 */
export default function CitationPopover({
  title,
  heading,
  hasUrl,
}: {
  title: string;
  heading: string | null;
  hasUrl: boolean;
}) {
  return (
    <span className="pointer-events-none absolute bottom-[18px] left-[-10px] z-10 w-[250px] rounded-lg bg-surface p-3 text-left opacity-0 shadow-[var(--shadow-pop)] transition-opacity delay-[50ms] group-hover/cite:pointer-events-auto group-hover/cite:opacity-100 group-focus-within/cite:opacity-100">
      <span className="block text-[12.5px] font-medium leading-snug text-ink">{title}</span>
      {heading && <span className="mt-0.5 block text-[11.5px] text-ink-muted">§ {heading}</span>}
      {hasUrl && (
        <span className="mt-2 block font-mono text-[10.5px] text-accent">open source ↗</span>
      )}
    </span>
  );
}
