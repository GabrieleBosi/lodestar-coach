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

  const base = "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium";

  if (state.status === "loading") {
    return (
      <span
        className={`${base} border-stone-300 text-stone-500 dark:border-stone-700 dark:text-stone-400`}
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-stone-400" />
        checking status…
      </span>
    );
  }

  if (state.status === "error") {
    return (
      <span
        className={`${base} border-red-300 text-red-700 dark:border-red-900 dark:text-red-400`}
        title={state.message}
      >
        <span className="h-2 w-2 rounded-full bg-red-500" />
        unavailable
      </span>
    );
  }

  return (
    <span
      className={`${base} border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-400`}
    >
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      healthy · {state.health.chatModel}
    </span>
  );
}
