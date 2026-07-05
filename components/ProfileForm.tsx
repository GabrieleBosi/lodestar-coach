"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Profile {
  display_name: string | null;
  units: string | null;
  goals: string | null;
  sex: string | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: string | null;
}

const EMPTY: Profile = {
  display_name: "",
  units: "metric",
  goals: "",
  sex: "",
  age: null,
  height_cm: null,
  weight_kg: null,
  activity_level: "",
};

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500 dark:border-stone-700 dark:bg-stone-900";

export default function ProfileForm() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">(
    "loading",
  );

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d: { profile: Profile | null }) => {
        if (d.profile) setProfile({ ...EMPTY, ...d.profile });
        setStatus("idle");
      })
      .catch(() => setStatus("idle"));
  }, []);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    setStatus(res.ok ? "saved" : "error");
    if (res.ok) setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
        <Link
          href="/app"
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
        >
          ← Back to chat
        </Link>
      </div>
      <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
        Lodestar uses this to personalize coaching and compute your energy targets. Everything is
        optional and private to you.
      </p>

      {status === "loading" ? (
        <p className="text-sm text-stone-500">Loading…</p>
      ) : (
        <form onSubmit={save} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Display name</span>
            <input
              className={inputClass}
              value={profile.display_name ?? ""}
              onChange={(e) => set("display_name", e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Goals</span>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="e.g. Lean-bulk while keeping conditioning"
              value={profile.goals ?? ""}
              onChange={(e) => set("goals", e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Sex</span>
              <select
                className={inputClass}
                value={profile.sex ?? ""}
                onChange={(e) => set("sex", e.target.value)}
              >
                <option value="">—</option>
                <option value="male">male</option>
                <option value="female">female</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Age</span>
              <input
                type="number"
                className={inputClass}
                value={profile.age ?? ""}
                onChange={(e) => set("age", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Height (cm)</span>
              <input
                type="number"
                className={inputClass}
                value={profile.height_cm ?? ""}
                onChange={(e) =>
                  set("height_cm", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Weight (kg)</span>
              <input
                type="number"
                className={inputClass}
                value={profile.weight_kg ?? ""}
                onChange={(e) =>
                  set("weight_kg", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Activity level</span>
              <select
                className={inputClass}
                value={profile.activity_level ?? ""}
                onChange={(e) => set("activity_level", e.target.value)}
              >
                <option value="">—</option>
                <option value="sedentary">sedentary</option>
                <option value="light">light</option>
                <option value="moderate">moderate</option>
                <option value="active">active</option>
                <option value="very_active">very active</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Units</span>
              <select
                className={inputClass}
                value={profile.units ?? "metric"}
                onChange={(e) => set("units", e.target.value)}
              >
                <option value="metric">metric</option>
                <option value="imperial">imperial</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={status === "saving"}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              {status === "saving" ? "Saving…" : "Save profile"}
            </button>
            {status === "saved" && <span className="text-sm text-emerald-600">Saved ✓</span>}
            {status === "error" && <span className="text-sm text-red-600">Couldn&apos;t save</span>}
          </div>
        </form>
      )}
    </main>
  );
}
