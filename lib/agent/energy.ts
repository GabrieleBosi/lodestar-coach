/**
 * Evidence-based energy & macro targets.
 *
 * Method: Mifflin–St Jeor BMR × activity multiplier for TDEE, then a goal
 * adjustment clamped to safe ranges. Intake is never returned below the BMR or
 * below a conservative absolute floor; when a requested target is clamped, an
 * explicit warning is returned and `safe` is false.
 */
export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Conservative absolute floors for self-directed dieting (general population).
const CALORIE_FLOOR: Record<Sex, number> = { male: 1500, female: 1200 };

// Safe adjustment bounds relative to TDEE.
const MAX_DEFICIT = 0.25; // no more aggressive than -25%
const MAX_SURPLUS = 0.2; // no more aggressive than +20%

export type GoalKind = "cut" | "maintain" | "bulk";

export interface EnergyInput {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activityLevel: ActivityLevel;
  goal: string;
  /** Optional explicit calorie target the user asked for (will be safety-clamped). */
  targetCalories?: number;
}

export interface EnergyTargets {
  bmr: number;
  tdee: number;
  goal: GoalKind;
  goalLabel: string;
  targetCalories: number;
  adjustmentPct: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  safe: boolean;
  warnings: string[];
  method: string;
}

function round(n: number): number {
  return Math.round(n);
}

export function classifyGoal(goal: string): GoalKind {
  const g = goal.toLowerCase();
  if (/(cut|lose|loss|deficit|lean.?out|shred|slim)/.test(g)) return "cut";
  if (/(bulk|gain|surplus|mass|grow|build)/.test(g)) return "bulk";
  return "maintain";
}

export function mifflinStJeor(input: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return base + (input.sex === "male" ? 5 : -161);
}

export function computeEnergyTargets(input: EnergyInput): EnergyTargets {
  const warnings: string[] = [];
  let safe = true;

  const bmr = mifflinStJeor(input);
  const tdee = bmr * ACTIVITY_MULTIPLIERS[input.activityLevel];
  const goal = classifyGoal(input.goal);

  // Default adjustment by goal.
  let adjustmentPct = goal === "cut" ? -0.2 : goal === "bulk" ? 0.1 : 0;

  // If the user asked for an aggressive change, clamp it.
  if (/(aggressive|extreme|crash|fast|rapid)/.test(input.goal.toLowerCase())) {
    if (goal === "cut") {
      adjustmentPct = -MAX_DEFICIT;
      warnings.push("Aggressive deficits are unsafe; clamped to -25% of maintenance.");
      safe = false;
    } else if (goal === "bulk") {
      adjustmentPct = MAX_SURPLUS;
      warnings.push("Very large surpluses mostly add fat; clamped to +20% of maintenance.");
      safe = false;
    }
  }

  let target = tdee * (1 + adjustmentPct);

  // Honor an explicit requested target, but clamp it for safety.
  if (typeof input.targetCalories === "number" && Number.isFinite(input.targetCalories)) {
    target = input.targetCalories;
    const maxDeficitCalories = tdee * (1 - MAX_DEFICIT);
    const maxSurplusCalories = tdee * (1 + MAX_SURPLUS);
    if (target < maxDeficitCalories) {
      warnings.push(
        `Requested ${round(input.targetCalories)} kcal exceeds a safe deficit; clamped to ${round(maxDeficitCalories)} kcal (-25%).`,
      );
      target = maxDeficitCalories;
      safe = false;
    } else if (target > maxSurplusCalories) {
      warnings.push(
        `Requested ${round(input.targetCalories)} kcal exceeds a safe surplus; clamped to ${round(maxSurplusCalories)} kcal (+20%).`,
      );
      target = maxSurplusCalories;
      safe = false;
    }
  }

  // Hard safety floors: never below BMR, never below the absolute floor.
  if (target < bmr) {
    warnings.push(
      `Target was below BMR (${round(bmr)} kcal); raised to BMR. Eating below BMR long-term is not advised.`,
    );
    target = bmr;
    safe = false;
  }
  const floor = CALORIE_FLOOR[input.sex];
  if (target < floor) {
    warnings.push(
      `Target was below the safe floor of ${floor} kcal; raised. Consider professional guidance for lower intakes.`,
    );
    target = floor;
    safe = false;
  }

  const finalAdjustmentPct = (target - tdee) / tdee;

  // Macros: protein 2.0 g/kg (2.2 when cutting to spare muscle), fat ~0.8 g/kg,
  // remainder from carbohydrate.
  const proteinPerKg = goal === "cut" ? 2.2 : 2.0;
  const protein_g = round(proteinPerKg * input.weightKg);
  const fat_g = round(0.8 * input.weightKg);
  const carbsCalories = Math.max(0, target - protein_g * 4 - fat_g * 9);
  const carbs_g = round(carbsCalories / 4);

  return {
    bmr: round(bmr),
    tdee: round(tdee),
    goal,
    goalLabel: input.goal,
    targetCalories: round(target),
    adjustmentPct: Math.round(finalAdjustmentPct * 100) / 100,
    protein_g,
    fat_g,
    carbs_g,
    safe,
    warnings,
    method:
      "Mifflin–St Jeor BMR × activity multiplier for TDEE; goal adjustment clamped to −25%…+20%; " +
      "protein 2.0–2.2 g/kg, fat ~0.8 g/kg, remainder carbohydrate.",
  };
}
