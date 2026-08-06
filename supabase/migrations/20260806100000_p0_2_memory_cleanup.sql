-- Issue #2, P0-2: one-time cleanup of pre-fix memory rows for user
-- 88e77c6e-0ef1-4318-a896-86a2576812ba (the QA account).
--
-- POLICY: facts owned by the `profiles` table (weight, height, age, sex, goal,
-- activity level, name) do not belong in `memories` — the profile is the
-- authoritative store and is always injected into the prompt, so a mirrored
-- memory row can only drift. Those rows are deleted; the two near-duplicate
-- squat-PR rows collapse to the newest.
--
-- ⚠️ IMPORTANT — the profile is NOT automatically the correct value.
-- An earlier draft of this migration assumed "the profile already holds the
-- current values". That is FALSE here, and it is the P0-2 bug fossilised: the
-- old code wrote a stated weight into `memories` and never wrote it back to
-- `profiles`. Live state at time of writing:
--
--     profiles.weight_kg          = 51     (updated_at 19:58:57)
--     memories 'Weighs 51 kg'     = 51     (created  19:57:23)
--     memories 'Weighs 62 kg'     = 62     (created  19:58:35)  <- newest memory
--
-- The other six profile-owned slots DO agree with the profile and are safe:
--     height 160 · age 25 · sex male · activity active
--     goals 'Lean-bulk while keeping conditioning.' · display_name 'Gabriele'
--
-- So weight — and only weight — must be reconciled by a human BEFORE deletion,
-- otherwise the sole surviving record that the weight ever changed is destroyed
-- and the app keeps answering off 51 kg with nothing left to contradict it.
-- STEP 2 below is written so it physically cannot delete an unreconciled
-- weight row, even if run blindly.
--
-- AUTO-EXECUTION: STEPS 0, 1 and 3 are comments; STEP 2 is live SQL. This file
-- lives in supabase/migrations/, so `supabase db push` (or any migration run)
-- executes STEP 2 unattended. That is deliberate and safe: 2a only removes rows
-- that provably match the profile, and 2b's guard leaves the weight conflict
-- untouched until a human resolves it in STEP 1. An unattended run therefore
-- does the uncontested cleanup and stops — it never picks a winner for you.
-- Both statements are idempotent; re-running deletes nothing new.

-- ── STEP 0 · CONFLICT REPORT (read-only — run this first) ────────────────────
-- Shows the profile beside every profile-owned memory so you can decide.
-- Expect one conflict: weight 51 (profile) vs 62 (newest memory).
--
-- select 'profile' as src, weight_kg::text as value, updated_at as ts
-- from public.profiles where id = '88e77c6e-0ef1-4318-a896-86a2576812ba'
-- union all
-- select 'memory', content, created_at
-- from public.memories
-- where user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba'
--   and content ~* '(weigh|kg)'
-- order by ts;

-- ── STEP 1 · RECONCILE WEIGHT (you choose — uncomment ONE) ───────────────────
-- (a) 62 kg is current (the later chat statement won):
--
-- update public.profiles set weight_kg = 62
-- where id = '88e77c6e-0ef1-4318-a896-86a2576812ba';
--
-- (b) 51 kg is current (the profile form won). The profile needs no update, but
--     STEP 2b's guard will then be false and would leave 'Weighs 51 kg' behind —
--     a profile-owned weight mirror, i.e. the very bug this migration removes.
--     So branch (b) retires BOTH weight rows itself, acknowledging that you
--     discarded the later 62 kg statement. Both branches then converge on one
--     surviving row and STEP 3 is branch-independent.
--
-- delete from public.memories
-- where user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba'
--   and id in (
--     'c88d9265-a3b9-4ea1-98c8-2505d8841d4c', -- Weighs 51 kg (now mirrored by the profile)
--     '9ced8de4-e0de-4fa2-84fd-d878b9804a09'  -- Weighs 62 kg (discarded)
--   );

-- ── STEP 2 · DELETE (safe to run; self-guarding on weight) ───────────────────

-- 2a. Ten ids: the NINE profile-owned rows that already agree with the profile,
--     plus the older of the two duplicate squat-PR rows. No conflict, no guard
--     needed. This statement is live (see the header note on auto-execution).
delete from public.memories
where user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba'
  and id in (
    'e002e4b7-a0b1-4392-b6a1-5077605f2bae', -- Name is Gabriele              (= profile.display_name)
    'b8593825-7d71-4e02-8e01-16d0e5068036', -- 25-year-old male              (= profile.age/sex)
    'b9602008-9cec-4ece-a8f4-c0e555adda71', -- Is a 25-year-old male         (dup)
    'b7fab090-adbe-43a0-aee6-810a8f68fea6', -- Height is 160 cm              (= profile.height_cm)
    'e5ead847-1828-42ce-9290-07bb093ac0c6', -- Is 160 cm tall                (dup)
    '18fab4aa-549b-4a06-a29f-4d407986343a', -- Has a goal of lean bulking    (= profile.goals)
    'acbb2b26-e2b3-421a-9889-6a54e9e1d592', -- Goal is lean bulking          (dup)
    '7ce20267-27bf-42bc-b1cc-5181fa2dfc76', -- Goal is a lean bulk           (dup)
    '6ae10d7a-7270-4e7e-81dc-acc441589e31', -- Has an active activity level  (= profile.activity_level)
    '3fb9c5af-72ba-470b-849c-64e96e354402'  -- older duplicate of the squat PR row
  );

-- 2b. The two weight rows — removed ONLY once the profile agrees with the
--     newest stated weight (62). If STEP 1 was skipped this deletes nothing and
--     leaves the conflict visible, which is the safe outcome.
delete from public.memories m
where m.user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba'
  and m.id in (
    'c88d9265-a3b9-4ea1-98c8-2505d8841d4c', -- Weighs 51 kg
    '9ced8de4-e0de-4fa2-84fd-d878b9804a09'  -- Weighs 62 kg
  )
  and exists (
    select 1 from public.profiles p
    where p.id = m.user_id
      and p.weight_kg = 62
  );

-- ── STEP 3 · VERIFY ─────────────────────────────────────────────────────────
-- select content from public.memories
-- where user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba';
--
-- After STEP 1(a) + STEP 2: exactly one row —
--   'Back squatted 102.5 kg for 5x5 at RPE 8 on August 5, 2026'
-- If you skipped STEP 1: three rows — the squat PR plus both weight rows,
-- still awaiting your decision.
