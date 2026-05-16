import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Check, Plus, Trash2, Pencil, Target, HelpCircle, Calculator, TrendingDown } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type {
  ActivityLevel,
  NutritionGoals,
  ProfileId,
  SaturatedFatMode,
  Sex,
  UserMetrics,
  WakeSleepSchedule,
  WeightLossPlan,
} from "../types";
import {
  ACTIVITY_LABELS,
  ACTIVITY_LEVELS,
  computeDeficitInfo,
  computeExpectedWeight,
  computeRecommendedGoals,
  computeWeightGoalEstimate,
} from "../calculator";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PendingAction } from "./ConfirmDialog";
import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { useUnsavedChanges } from "../unsavedChanges";

function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex cursor-help">
      <HelpCircle className="h-3 w-3 text-muted-foreground" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-48 -translate-x-1/2 rounded-md bg-popover px-2 py-1.5 text-[10px] leading-tight text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface GoalsEditorProps {
  goals: NutritionGoals | null;
  schedule: WakeSleepSchedule | null;
  userMetrics: UserMetrics | null;
  weightLossPlan: WeightLossPlan | null;
  onSave: (
    goals: NutritionGoals | null,
    schedule: WakeSleepSchedule | null,
    userMetrics: UserMetrics | null,
  ) => void;
  onSetPlan: (plan: WeightLossPlan | null) => void;
  onClose: () => void;
}

function GoalsEditor({ goals, schedule, userMetrics, weightLossPlan, onSave, onSetPlan, onClose }: GoalsEditorProps) {
  // Body metrics state
  const [sex, setSex] = useState<Sex>(userMetrics?.sex ?? "male");
  const [age, setAge] = useState(String(userMetrics?.age ?? ""));
  const [heightCm, setHeightCm] = useState(String(userMetrics?.heightCm ?? ""));
  const [weightKg, setWeightKg] = useState(String(userMetrics?.weightKg ?? ""));
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(
    userMetrics?.activityLevel ?? "moderately_active",
  );
  const [targetWeight, setTargetWeight] = useState(
    String(userMetrics?.targetWeightKg ?? ""),
  );
  const [proteinPerKg, setProteinPerKg] = useState(
    String(userMetrics?.proteinPerKg ?? "1.8"),
  );
  const [weightLossRate, setWeightLossRate] = useState(
    String(userMetrics?.weightLossRateKg ?? "0.5"),
  );

  // Goals state
  const [calories, setCalories] = useState(String(goals?.calories ?? ""));
  const [protein, setProtein] = useState(String(goals?.protein ?? ""));
  const [saturatedFat, setSaturatedFat] = useState(String(goals?.saturatedFat ?? ""));
  const [satFatMode, setSatFatMode] = useState<SaturatedFatMode>(goals?.saturatedFatMode ?? "percentage");
  const [fiber, setFiber] = useState(String(goals?.fiber ?? ""));
  const [wakeHour, setWakeHour] = useState(String(schedule?.wakeHour ?? 7));
  const [sleepHour, setSleepHour] = useState(String(schedule?.sleepHour ?? 23));
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  const isDirty =
    sex !== (userMetrics?.sex ?? "male") ||
    age !== String(userMetrics?.age ?? "") ||
    heightCm !== String(userMetrics?.heightCm ?? "") ||
    weightKg !== String(userMetrics?.weightKg ?? "") ||
    activityLevel !== (userMetrics?.activityLevel ?? "moderately_active") ||
    targetWeight !== String(userMetrics?.targetWeightKg ?? "") ||
    proteinPerKg !== String(userMetrics?.proteinPerKg ?? "1.8") ||
    weightLossRate !== String(userMetrics?.weightLossRateKg ?? "0.5") ||
    calories !== String(goals?.calories ?? "") ||
    protein !== String(goals?.protein ?? "") ||
    saturatedFat !== String(goals?.saturatedFat ?? "") ||
    satFatMode !== (goals?.saturatedFatMode ?? "percentage") ||
    fiber !== String(goals?.fiber ?? "") ||
    wakeHour !== String(schedule?.wakeHour ?? 7) ||
    sleepHour !== String(schedule?.sleepHour ?? 23);

  useUnsavedChanges(isDirty, {
    title: "Discard goal changes?",
    description:
      "Leaving now will lose the profile goals you have not saved.",
  });

  function requestClose() {
    if (isDirty) {
      setDiscardDialogOpen(true);
      return;
    }

    onClose();
  }

  const parsedMetrics = useMemo((): UserMetrics | null => {
    const a = parseInt(age, 10);
    const h = parseFloat(heightCm);
    const w = parseFloat(weightKg);
    const ppk = parseFloat(proteinPerKg);
    const tw = parseFloat(targetWeight);
    const wlr = parseFloat(weightLossRate);

    if (Number.isNaN(a) || Number.isNaN(h) || Number.isNaN(w)) return null;
    if (a <= 0 || h <= 0 || w <= 0) return null;

    return {
      sex,
      age: a,
      heightCm: h,
      weightKg: w,
      activityLevel,
      targetWeightKg: Number.isNaN(tw) || tw <= 0 ? null : tw,
      proteinPerKg: Number.isNaN(ppk) || ppk <= 0 ? 1.8 : ppk,
      weightLossRateKg: Number.isNaN(wlr) || wlr <= 0 ? 0.5 : wlr,
    };
  }, [sex, age, heightCm, weightKg, activityLevel, targetWeight, proteinPerKg, weightLossRate]);

  function handleCalculate() {
    if (parsedMetrics == null) return;
    const rec = computeRecommendedGoals(parsedMetrics);
    setCalories(String(rec.calories));
    setProtein(String(rec.protein));
    setSaturatedFat(String(rec.saturatedFatPercentage));
    setSatFatMode("percentage");
    setFiber(String(rec.fiber));
  }

  const deficitInfo = useMemo(() => {
    if (parsedMetrics == null) return null;
    const cal = parseFloat(calories);
    if (Number.isNaN(cal) || cal <= 0) return null;
    return computeDeficitInfo(parsedMetrics, cal);
  }, [parsedMetrics, calories]);

  const weightEstimate = useMemo(() => {
    if (parsedMetrics == null) return null;
    const cal = parseFloat(calories);
    if (Number.isNaN(cal) || cal <= 0) return null;
    return computeWeightGoalEstimate(parsedMetrics, cal);
  }, [parsedMetrics, calories]);

  function handleSave() {
    const cal = parseFloat(calories);
    const prot = parseFloat(protein);
    const sat = parseFloat(saturatedFat);
    const fib = parseFloat(fiber);
    const wake = parseInt(wakeHour, 10);
    const sleep = parseInt(sleepHour, 10);

    const hasAnyGoal = [cal, prot, sat, fib].some((v) => !Number.isNaN(v) && v > 0);

    const newGoals: NutritionGoals | null = hasAnyGoal
      ? {
          calories: Number.isNaN(cal) ? 0 : cal,
          protein: Number.isNaN(prot) ? 0 : prot,
          saturatedFat: Number.isNaN(sat) ? 0 : sat,
          saturatedFatMode: satFatMode,
          fiber: Number.isNaN(fib) ? 0 : fib,
        }
      : null;

    const newSchedule: WakeSleepSchedule | null =
      !Number.isNaN(wake) && !Number.isNaN(sleep) && wake >= 0 && wake <= 23 && sleep >= 0 && sleep <= 23
        ? { wakeHour: wake, sleepHour: sleep }
        : null;

    onSave(newGoals, newSchedule, parsedMetrics);
    onClose();
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        {/* Body Metrics */}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Body Metrics
        </p>
        <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="metric-sex" className="text-xs">Sex</Label>
          <select
            id="metric-sex"
            value={sex}
            onChange={(e) => setSex(e.target.value === "male" ? "male" : "female")}
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background"
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
        <div>
          <Label htmlFor="metric-age" className="text-xs">Age (years)</Label>
          <Input
            id="metric-age"
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="e.g. 30"
            className="h-8 text-sm"
            min={1}
          />
        </div>
        <div>
          <Label htmlFor="metric-height" className="text-xs">Height (cm)</Label>
          <Input
            id="metric-height"
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            placeholder="e.g. 175"
            className="h-8 text-sm"
            step="any"
            min={1}
          />
        </div>
        <div>
          <Label htmlFor="metric-weight" className="text-xs">Weight (kg)</Label>
          <Input
            id="metric-weight"
            type="number"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="e.g. 80"
            className="h-8 text-sm"
            step="any"
            min={1}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="metric-activity" className="text-xs">
            Activity Level
            <Tooltip text="Based on how often you exercise. Affects your total daily energy expenditure (TDEE)." />
          </Label>
          <select
            id="metric-activity"
            value={activityLevel}
            onChange={(e) => setActivityLevel(e.target.value as ActivityLevel)}
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm ring-offset-background"
          >
            {ACTIVITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {ACTIVITY_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="metric-target-weight" className="text-xs">
            Target Weight (kg)
            <Tooltip text="Optional. If set and you have a calorie deficit, we'll estimate when you'll reach this weight." />
          </Label>
          <Input
            id="metric-target-weight"
            type="number"
            value={targetWeight}
            onChange={(e) => setTargetWeight(e.target.value)}
            placeholder="e.g. 75"
            className="h-8 text-sm"
            step="any"
            min={1}
          />
        </div>
        <div>
          <Label htmlFor="metric-protein-ratio" className="text-xs">
            Protein (g/kg)
            <Tooltip text="Grams of protein per kg of body weight. Lifters: 1.6–2.2 g/kg. Default 1.8 g/kg." />
          </Label>
          <Input
            id="metric-protein-ratio"
            type="number"
            value={proteinPerKg}
            onChange={(e) => setProteinPerKg(e.target.value)}
            placeholder="1.8"
            className="h-8 text-sm"
            step="0.1"
            min={0.1}
          />
        </div>
        {parsedMetrics != null &&
          parsedMetrics.targetWeightKg != null &&
          parsedMetrics.targetWeightKg < parsedMetrics.weightKg && (
          <div className="col-span-2">
            <Label htmlFor="metric-loss-rate" className="text-xs">
              Weight Loss Rate (kg/week)
              <Tooltip text="How fast you want to lose weight. 0.5 kg/week is moderate, 1.0 kg/week is aggressive. The calculator subtracts the corresponding deficit from your TDEE." />
            </Label>
            <Input
              id="metric-loss-rate"
              type="number"
              value={weightLossRate}
              onChange={(e) => setWeightLossRate(e.target.value)}
              placeholder="0.5"
              className="h-8 text-sm"
              step="0.1"
              min={0.1}
            />
          </div>
        )}
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleCalculate}
          disabled={parsedMetrics == null}
          className="w-full"
        >
          <Calculator className="mr-1.5 h-3.5 w-3.5" />
          Calculate Recommended Goals
        </Button>

      {/* Deficit / Weight Goal Info */}
      {deficitInfo != null && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <p className="font-medium">
            {deficitInfo.deficitPercentage}% deficit — {deficitInfo.dailyDeficit} kcal/day below maintenance
          </p>
          <p>
            ≈ {deficitInfo.weeklyWeightLossKg.toFixed(2)} kg/week weight loss
          </p>
          {weightEstimate != null && (
            <p className="mt-1 font-medium">
              Target weight by ≈ {formatDate(weightEstimate.estimatedDate)} ({weightEstimate.estimatedDays} days)
            </p>
          )}
        </div>
      )}

      {/* Daily Goals */}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Daily Goals
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="goal-cal" className="text-xs">
            Calories (kcal)
            <Tooltip text="Mifflin-St Jeor BMR × activity multiplier. Reduce to create a deficit for weight loss." />
          </Label>
          <Input
            id="goal-cal"
            type="number"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            placeholder="e.g. 2000"
            className="h-8 text-sm"
            step="any"
          />
        </div>
        <div>
          <Label htmlFor="goal-prot" className="text-xs">
            Protein (g)
            <Tooltip text="Recommended 1.6–2.2 g/kg body weight for lifters. Computed from your protein ratio setting." />
          </Label>
          <Input
            id="goal-prot"
            type="number"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            placeholder="e.g. 120"
            className="h-8 text-sm"
            step="any"
          />
        </div>
        <div>
          <Label htmlFor="goal-sat" className="text-xs">
            Sat. Fat ({satFatMode === "grams" ? "g" : "% of kcal"})
            <Tooltip text="WHO/AHA recommends < 10% of total calories from saturated fat." />
          </Label>
          <div className="flex gap-1">
            <Input
              id="goal-sat"
              type="number"
              value={saturatedFat}
              onChange={(e) => setSaturatedFat(e.target.value)}
              placeholder={satFatMode === "grams" ? "e.g. 20" : "e.g. 10"}
              className="h-8 min-w-0 flex-1 text-sm"
              step="any"
            />
            <button
              type="button"
              className={`shrink-0 rounded-md border px-2 text-[10px] transition-colors ${
                satFatMode === "percentage"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input hover:bg-accent"
              }`}
              onClick={() => setSatFatMode(satFatMode === "grams" ? "percentage" : "grams")}
            >
              {satFatMode === "grams" ? "g" : "%"}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="goal-fib" className="text-xs">
            Fiber (g)
            <Tooltip text={`14g per 1000 kcal. Min ${sex === "male" ? "28g (men)" : "22g (women)"}. FDA Daily Value: 28g.`} />
          </Label>
          <Input
            id="goal-fib"
            type="number"
            value={fiber}
            onChange={(e) => setFiber(e.target.value)}
            placeholder="e.g. 30"
            className="h-8 text-sm"
            step="any"
          />
        </div>
      </div>

      {/* Active Hours */}
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Active Hours
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="wake-hour" className="text-xs">Wake hour (0–23)</Label>
          <Input
            id="wake-hour"
            type="number"
            value={wakeHour}
            onChange={(e) => setWakeHour(e.target.value)}
            min={0}
            max={23}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="sleep-hour" className="text-xs">Sleep hour (0–23)</Label>
          <Input
            id="sleep-hour"
            type="number"
            value={sleepHour}
            onChange={(e) => setSleepHour(e.target.value)}
            min={0}
            max={23}
            className="h-8 text-sm"
          />
        </div>
      </div>
        <p className="text-[10px] text-muted-foreground">
          The daily budget grows linearly from wake to sleep hour.
        </p>
      </form>

      {/* Weight Loss Plan */}
      <WeightLossPlanSection
        plan={weightLossPlan}
        userMetrics={parsedMetrics}
        onSetPlan={onSetPlan}
      />

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={handleSave}>
          Save Goals
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={requestClose}>
          Cancel
        </Button>
      </div>
      <DiscardChangesDialog
        open={discardDialogOpen}
        title="Discard goal changes?"
        description="Closing now will lose the profile goals you have not saved."
        onStay={() => setDiscardDialogOpen(false)}
        onDiscard={() => {
          setDiscardDialogOpen(false);
          onClose();
        }}
      />
    </div>
  );
}

interface WeightLossPlanSectionProps {
  plan: WeightLossPlan | null;
  userMetrics: UserMetrics | null;
  onSetPlan: (plan: WeightLossPlan | null) => void;
}

function WeightLossPlanSection({ plan, userMetrics, onSetPlan }: WeightLossPlanSectionProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [startWeight, setStartWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [lossRate, setLossRate] = useState("");

  const isDirty =
    isCreating &&
    (startWeight !== String(userMetrics?.weightKg ?? "") ||
      targetWeight !== String(userMetrics?.targetWeightKg ?? "") ||
      lossRate !== String(userMetrics?.weightLossRateKg ?? "0.5"));

  useUnsavedChanges(isDirty, {
    title: "Discard weight plan?",
    description:
      "Leaving now will lose the weight-loss plan you have not started.",
  });

  function startCreating() {
    setStartWeight(String(userMetrics?.weightKg ?? ""));
    setTargetWeight(String(userMetrics?.targetWeightKg ?? ""));
    setLossRate(String(userMetrics?.weightLossRateKg ?? "0.5"));
    setIsCreating(true);
  }

  function handleCreate() {
    const sw = parseFloat(startWeight);
    const tw = parseFloat(targetWeight);
    const lr = parseFloat(lossRate);
    if (Number.isNaN(sw) || Number.isNaN(tw) || Number.isNaN(lr)) return;
    if (sw <= 0 || tw <= 0 || lr <= 0 || tw >= sw) return;

    onSetPlan({
      startDate: format(new Date(), "yyyy-MM-dd"),
      startWeightKg: sw,
      targetWeightKg: tw,
      weeklyLossRateKg: lr,
    });
    setIsCreating(false);
  }

  if (plan != null) {
    const expectedToday = computeExpectedWeight(plan, format(new Date(), "yyyy-MM-dd"));
    const totalKgToLose = plan.startWeightKg - plan.targetWeightKg;
    const totalWeeks = totalKgToLose / plan.weeklyLossRateKg;
    const estimatedEndDate = new Date(plan.startDate);
    estimatedEndDate.setDate(estimatedEndDate.getDate() + Math.ceil(totalWeeks * 7));

    return (
      <>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Weight Loss Plan
        </p>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <div className="flex items-center gap-1.5 font-medium">
            <TrendingDown className="h-3.5 w-3.5" />
            Active plan
          </div>
          <p className="mt-1">
            {plan.startWeightKg} kg → {plan.targetWeightKg} kg at {plan.weeklyLossRateKg} kg/week
          </p>
          <p>Started {plan.startDate}</p>
          {expectedToday != null && (
            <p className="font-medium">
              Expected today: {expectedToday.toFixed(1)} kg
            </p>
          )}
          <p>
            ETA: {formatDate(estimatedEndDate)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-7 text-xs"
            onClick={() => onSetPlan(null)}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Remove Plan
          </Button>
        </div>
      </>
    );
  }

  if (isCreating) {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Start Weight Loss Plan
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label htmlFor="plan-start-weight" className="text-xs">Start (kg)</Label>
            <Input
              id="plan-start-weight"
              type="number"
              value={startWeight}
              onChange={(e) => setStartWeight(e.target.value)}
              placeholder="e.g. 85"
              className="h-8 text-sm"
              step="0.1"
              min={1}
            />
          </div>
          <div>
            <Label htmlFor="plan-target-weight" className="text-xs">Target (kg)</Label>
            <Input
              id="plan-target-weight"
              type="number"
              value={targetWeight}
              onChange={(e) => setTargetWeight(e.target.value)}
              placeholder="e.g. 75"
              className="h-8 text-sm"
              step="0.1"
              min={1}
            />
          </div>
          <div>
            <Label htmlFor="plan-loss-rate" className="text-xs">Rate (kg/wk)</Label>
            <Input
              id="plan-loss-rate"
              type="number"
              value={lossRate}
              onChange={(e) => setLossRate(e.target.value)}
              placeholder="0.5"
              className="h-8 text-sm"
              step="0.1"
              min={0.1}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Start Plan
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsCreating(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Weight Loss Plan
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full"
        onClick={startCreating}
      >
        <TrendingDown className="mr-1.5 h-3.5 w-3.5" />
        Start a Weight Loss Plan
      </Button>
    </>
  );
}

interface ProfileManagerProps {
  appData: AppDataHandle;
}

export function ProfileManager({ appData }: ProfileManagerProps) {
  const { data, addProfile, setActiveProfile, deleteProfile, renameProfile, updateProfileGoals, setWeightLossPlan } =
    appData;
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<ProfileId | null>(null);
  const [editName, setEditName] = useState("");
  const [goalsEditingId, setGoalsEditingId] = useState<ProfileId | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingAction | null>(null);
  const editingProfile =
    editingId != null
      ? data.profiles.find((profile) => profile.id === editingId)
      : undefined;
  const isDirty =
    newName.trim().length > 0 ||
    (editingProfile != null && editName !== editingProfile.name);

  useUnsavedChanges(isDirty, {
    title: "Discard profile changes?",
    description:
      "Leaving now will lose the profile changes you have not saved.",
  });

  function handleCreate() {
    const trimmed = newName.trim();
    if (trimmed.length === 0) return;
    addProfile(trimmed);
    setNewName("");
  }

  function startEditing(profileId: ProfileId, currentName: string) {
    setEditingId(profileId);
    setEditName(currentName);
  }

  function finishEditing() {
    if (editingId != null && editName.trim().length > 0) {
      renameProfile(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold">Profiles</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Create Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreate();
            }}
          >
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. My Diet, Summer Plan..."
            />
            <Button type="submit">
              <Plus className="mr-1 h-4 w-4" />
              Create
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Each profile is an independent tracking context — like a separate
            notebook for tracking your intake.
          </p>
        </CardContent>
      </Card>

      {data.profiles.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No profiles yet. Create one above to start tracking.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {data.profiles.map((profile) => {
          const isActive = data.activeProfileId === profile.id;
          const isEditing = editingId === profile.id;
          const totalDays = profile.dayLogs.length;
          const totalEntries = profile.dayLogs.reduce(
            (sum, dl) => sum + dl.entries.length,
            0,
          );

          return (
            <Card
              key={profile.id}
              className={isActive ? "border-primary/50" : ""}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          finishEditing();
                        }}
                      >
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="h-8"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">
                            {profile.name}
                          </p>
                          {isActive && (
                            <Badge variant="success">Active</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {totalDays} days · {totalEntries} entries
                        </p>
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex gap-1">
                      {!isActive && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setActiveProfile(profile.id as ProfileId)
                          }
                        >
                          Select
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          startEditing(
                            profile.id as ProfileId,
                            profile.name,
                          )
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setGoalsEditingId(
                            goalsEditingId === profile.id
                              ? null
                              : (profile.id as ProfileId),
                          )
                        }
                      >
                        <Target className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setPendingDelete({
                            title: "Delete profile",
                            description: `Delete profile "${profile.name}"? All its logs will be lost.`,
                            onConfirm: () =>
                              deleteProfile(profile.id as ProfileId),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                {goalsEditingId === profile.id && (
                  <GoalsEditor
                    goals={profile.goals ?? null}
                    schedule={profile.schedule ?? null}
                    userMetrics={profile.userMetrics ?? null}
                    weightLossPlan={profile.weightLossPlan ?? null}
                    onSave={(goals, schedule, userMetrics) =>
                      updateProfileGoals(profile.id as ProfileId, goals, schedule, userMetrics)
                    }
                    onSetPlan={(plan) =>
                      setWeightLossPlan(profile.id as ProfileId, plan)
                    }
                    onClose={() => setGoalsEditingId(null)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
