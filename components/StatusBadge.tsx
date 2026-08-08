"use client";

import { useEffect, useState } from "react";

interface Health {
  ok: boolean;
  chatModel: string;
  embedModel: string;
  embedDim: number;
  time: string;
}

type State =
  | { status: "loading" }
  | { status: "healthy"; health: Health }
  | { status: "error"; message: string };

export default function StatusBadge() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;

    fetch("/api/health")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return (await res.json()) as Health;
      })
      .then((health) => {
        if (active) {
          setState({ status: "healthy", health });
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "unknown error",
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  // A mono status line, not a pill — the same information rendered as
  // instrumentation rather than a badge (issue #3, D-6 "trust signal styled
  // like debug output": the styling changes, the live fetch stays).
  const base = "inline-flex items-center gap-2 font-mono text-xs text-ink-muted";

  if (state.status === "loading") {
    return (
      <span className={base}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
        checking status…
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span className={base} title={state.message}>
        <span className="h-1.5 w-1.5 rounded-full bg-err" />
        unavailable
      </span>
    );
  }

  return (
    <span className={base}>
      <span className="h-1.5 w-1.5 rounded-full bg-ok" />
      healthy · {state.health.chatModel}
    </span>
  );
}
