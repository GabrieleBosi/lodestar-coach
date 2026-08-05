-- Issue #2, P0-2: one-time cleanup of pre-fix memory rows for user
-- 88e77c6e-0ef1-4318-a896-86a2576812ba (the QA account).
--
-- Policy (agreed on the issue): facts owned by the profiles table — weight,
-- height, age, sex, goal, activity level, name — are deleted outright (the
-- profile is authoritative and already holds the current values). The two
-- near-duplicate squat-PR rows collapse to the newest one.
--
-- Run the PREVIEW first; the DELETE below targets exactly those ids.
-- Idempotent: re-running deletes nothing new.

-- ── PREVIEW ─────────────────────────────────────────────────────────────────
-- Expected: 12 rows marked DELETE, 1 row marked KEEP.
--
-- select id, content, created_at,
--        case
--          when id in (
--            'e002e4b7-a0b1-4392-b6a1-5077605f2bae', -- Name is Gabriele                (profile: display_name)
--            'c88d9265-a3b9-4ea1-98c8-2505d8841d4c', -- Weighs 51 kg                    (profile: weight_kg, stale)
--            '9ced8de4-e0de-4fa2-84fd-d878b9804a09', -- Weighs 62 kg                    (profile: weight_kg)
--            'b8593825-7d71-4e02-8e01-16d0e5068036', -- 25-year-old male                (profile: age/sex)
--            'b9602008-9cec-4ece-a8f4-c0e555adda71', -- Is a 25-year-old male           (profile: age/sex, dup)
--            'b7fab090-adbe-43a0-aee6-810a8f68fea6', -- Height is 160 cm                (profile: height_cm)
--            'e5ead847-1828-42ce-9290-07bb093ac0c6', -- Is 160 cm tall                  (profile: height_cm, dup)
--            '18fab4aa-549b-4a06-a29f-4d407986343a', -- Has a goal of lean bulking      (profile: goals)
--            'acbb2b26-e2b3-421a-9889-6a54e9e1d592', -- Goal is lean bulking            (profile: goals, dup)
--            '7ce20267-27bf-42bc-b1cc-5181fa2dfc76', -- Goal is a lean bulk             (profile: goals, dup)
--            '6ae10d7a-7270-4e7e-81dc-acc441589e31', -- Has an active activity level    (profile: activity_level)
--            '3fb9c5af-72ba-470b-849c-64e96e354402'  -- Completed a 5x5 back squat...   (older dup of the kept row)
--          ) then 'DELETE'
--          else 'KEEP'                               -- 41683227-...: 'Back squatted 102.5 kg for 5x5 at RPE 8 on August 5, 2026'
--        end as action
-- from public.memories
-- where user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba'
-- order by created_at;

-- ── DELETE ──────────────────────────────────────────────────────────────────
delete from public.memories
where user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba'
  and id in (
    'e002e4b7-a0b1-4392-b6a1-5077605f2bae',
    'c88d9265-a3b9-4ea1-98c8-2505d8841d4c',
    '9ced8de4-e0de-4fa2-84fd-d878b9804a09',
    'b8593825-7d71-4e02-8e01-16d0e5068036',
    'b9602008-9cec-4ece-a8f4-c0e555adda71',
    'b7fab090-adbe-43a0-aee6-810a8f68fea6',
    'e5ead847-1828-42ce-9290-07bb093ac0c6',
    '18fab4aa-549b-4a06-a29f-4d407986343a',
    'acbb2b26-e2b3-421a-9889-6a54e9e1d592',
    '7ce20267-27bf-42bc-b1cc-5181fa2dfc76',
    '6ae10d7a-7270-4e7e-81dc-acc441589e31',
    '3fb9c5af-72ba-470b-849c-64e96e354402'
  );

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- select content from public.memories
-- where user_id = '88e77c6e-0ef1-4318-a896-86a2576812ba';
-- Expected: exactly one row — 'Back squatted 102.5 kg for 5x5 at RPE 8 on August 5, 2026'.
