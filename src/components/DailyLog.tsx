import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { format, addDays, subDays } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Plus,
  Trash2,
  GripVertical,
  Lock,
  LockOpen,
  AlertTriangle,
  Weight,
  MessageSquare,
  TrendingDown,
  Copy,
  CalendarCheck,
  Utensils,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AppDataHandle } from "../appDataType";
import type { DayLog, DayLogItem, Food, LogEntry, LogEntryId, NutritionGoals, NutritionValues, ProfileId, QuickAddEntry, WakeSleepSchedule } from "../types";
import { computeExpectedWeight } from "../calculator";
import { nutritionForEntry, sumNutrition, getTimeBudgetFraction } from "../nutrition";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { AddEntryDialog } from "./AddEntryDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PendingAction } from "./ConfirmDialog";

const SEPARATOR_PRESETS = ["Breakfast", "Lunch", "Merienda", "Dinner", "Snack"];

interface DailyLogProps {
  appData: AppDataHandle;
}

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatNutritionSummary(values: NutritionValues): string {
  return `${Math.round(values.calories)} kcal, ${formatNumber(values.protein)}g protein, ${formatNumber(values.saturatedFat)}g sat fat, ${formatNumber(values.fiber)}g fiber`;
}

function hasNutrition(values: NutritionValues): boolean {
  return values.calories > 0 || values.protein > 0 || values.saturatedFat > 0 || values.fiber > 0;
}

function addNutritionValues(
  a: NutritionValues,
  b: NutritionValues,
): NutritionValues {
  return {
    calories: Math.round((a.calories + b.calories) * 10) / 10,
    protein: Math.round((a.protein + b.protein) * 10) / 10,
    saturatedFat: Math.round((a.saturatedFat + b.saturatedFat) * 10) / 10,
    fiber: Math.round((a.fiber + b.fiber) * 10) / 10,
  };
}

function isToday(date: Date): boolean {
  return formatDate(date) === formatDate(new Date());
}

function describeEntryAmount(entry: LogEntry, food: Food): string {
  if (entry.units != null && food.nutritionPerUnit != null) {
    return `${formatNumber(entry.units)} unit${entry.units === 1 ? "" : "s"}`;
  }

  if (food.gramsPerUnit != null && food.gramsPerUnit > 0) {
    const exactUnits = entry.grams / food.gramsPerUnit;
    if (Number.isInteger(exactUnits)) {
      return `${formatNumber(exactUnits)} unit${exactUnits === 1 ? "" : "s"} (${formatNumber(entry.grams)}g)`;
    }
  }

  return `${formatNumber(entry.grams)}g`;
}

function buildMarkdownForDay(
  dayLog: DayLog | undefined,
  foodsMap: Map<string, Food>,
  expectedWeightKg: number | null,
  dateStr: string,
): string {
  const items = dayLog?.entries ?? [];
  const totals = sumNutrition(items, foodsMap, { status: "consumed" });
  const budgetedTotals = sumNutrition(items, foodsMap, { status: "budgeted" });
  const lines = [`## ${dateStr}`];

  lines.push(`- Consumed totals: ${formatNutritionSummary(totals)}`);
  if (hasNutrition(budgetedTotals)) {
    lines.push(`- Budgeted totals: ${formatNutritionSummary(budgetedTotals)}`);
  }

  if (dayLog?.weightKg != null || expectedWeightKg != null) {
    const weightParts: string[] = [];
    if (dayLog?.weightKg != null) {
      weightParts.push(`weight ${formatNumber(dayLog.weightKg)} kg`);
    }
    if (expectedWeightKg != null) {
      weightParts.push(`expected ${expectedWeightKg.toFixed(1)} kg`);
    }
    lines.push(`- Weight: ${weightParts.join(", ")}`);
  }

  if (items.length === 0) {
    lines.push("- Entries: none");
    return lines.join("\n");
  }

  lines.push("- Entries:");

  let currentSection: string | null = null;
  for (const item of items) {
    if (item.type === "separator") {
      currentSection = item.label;
      lines.push(`  - Section: ${item.label}`);
      continue;
    }

    if (item.type === "quick-add") {
      const sectionPrefix = currentSection != null ? `[${currentSection}] ` : "";
      const statusPrefix = item.isBudgeted === true ? "[Budgeted] " : "";
      lines.push(
        `  - ${sectionPrefix}${statusPrefix}${item.name}: quick add; ${formatNutritionSummary(item.nutrition)}`,
      );

      if (item.notes != null && item.notes.trim().length > 0) {
        lines.push(`  - Note: ${item.notes.trim()}`);
      }
      continue;
    }

    const food = foodsMap.get(item.foodId);
    if (food == null) continue;

    const sectionPrefix = currentSection != null ? `[${currentSection}] ` : "";
    const statusPrefix = item.isBudgeted === true ? "[Budgeted] " : "";
    const entryNutrition = nutritionForEntry(item, food);
    const entryLine = `  - ${sectionPrefix}${statusPrefix}${food.name}: ${describeEntryAmount(item, food)}; ${formatNutritionSummary(entryNutrition)}`;
    lines.push(entryLine);

    if (item.notes != null && item.notes.trim().length > 0) {
      lines.push(`  - Note: ${item.notes.trim()}`);
    }
  }

  return lines.join("\n");
}

interface SortableItemProps {
  item: DayLogItem;
  isLocked: boolean;
  children: React.ReactNode;
}

function SortableItem({ item, isLocked, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: isLocked });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-1 ${isDragging ? "z-10 opacity-50" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
    >
      {!isLocked && (
        <button
          className="touch-none p-1 text-muted-foreground"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface BudgetBarProps {
  actual: number;
  budget: number;
  invertColor?: boolean;
  aboveGoalIsGood?: boolean;
}

function budgetBarColor(actual: number, budget: number, invert: boolean, aboveGoalIsGood: boolean): string {
  const ratio = actual / budget;
  if (aboveGoalIsGood) {
    return ratio >= 1 ? "bg-emerald-500" : "bg-yellow-500";
  }
  if (invert) {
    if (ratio > 1) return "bg-emerald-500";
    if (ratio >= 0.9) return "bg-yellow-500";
    return "bg-red-500";
  }
  if (ratio > 1) return "bg-red-500";
  if (ratio >= 0.9) return "bg-yellow-500";
  return "bg-emerald-500";
}

function BudgetBar({ actual, budget, invertColor, aboveGoalIsGood }: BudgetBarProps) {
  if (budget <= 0) return null;
  const pct = Math.min(100, (actual / budget) * 100);
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className={`h-full rounded-full transition-all duration-300 ${budgetBarColor(actual, budget, invertColor === true, aboveGoalIsGood === true)}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function SectionSubtotal({ totals }: { totals: NutritionValues }) {
  return (
    <div className="mt-1 flex justify-end gap-3 px-1 text-[11px] text-muted-foreground">
      <span>{Math.round(totals.calories)} kcal</span>
      <span>{Math.round(totals.protein)}g prot</span>
      <span>{Math.round(totals.saturatedFat)}g sat</span>
      <span>{Math.round(totals.fiber)}g fib</span>
    </div>
  );
}

interface MetricCellProps {
  actual: number;
  budget: number | null;
  dailyGoal: number | null;
  unit: string;
  label: string;
  highlight?: boolean;
  invertColor?: boolean;
  aboveGoalIsGood?: boolean;
}

function MetricCell({ actual, budget, dailyGoal, unit, label, highlight, invertColor, aboveGoalIsGood }: MetricCellProps) {
  const over = budget != null && budget > 0 && actual > budget;
  const under = budget != null && budget > 0 && actual < budget;
  const isRed = aboveGoalIsGood === true ? false : invertColor === true ? under : over;
  const isYellow = aboveGoalIsGood === true ? under : false;
  const isGreen = aboveGoalIsGood === true ? over : invertColor === true ? over : false;
  const suffix = unit !== "kcal" ? "g" : "";
  const showDailyGoal =
    dailyGoal != null &&
    budget != null &&
    Math.round(dailyGoal) !== Math.round(budget);
  return (
    <div>
      <p className={`text-lg font-bold ${highlight === true ? "text-primary" : ""} ${isRed ? "text-red-500" : ""} ${isYellow ? "text-yellow-500" : ""} ${isGreen ? "text-emerald-500" : ""}`}>
        {Math.round(actual)}{suffix}
      </p>
      {budget != null && budget > 0 && (
        <p className="text-[10px] text-muted-foreground">
          / {Math.round(budget)}{suffix}
          {showDailyGoal === true && (
            <span className="opacity-60">
              {" "}of {Math.round(dailyGoal)}{suffix}
            </span>
          )}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {budget != null && budget > 0 && (
        <BudgetBar actual={actual} budget={budget} invertColor={invertColor} aboveGoalIsGood={aboveGoalIsGood} />
      )}
    </div>
  );
}

interface DailyTotalsCardProps {
  totals: NutritionValues;
  budgetedTotals: NutritionValues;
  goals: NutritionGoals | null;
  schedule: WakeSleepSchedule | null;
  isSelectedDayToday: boolean;
}

function DailyTotalsCard({ totals, budgetedTotals, goals, schedule, isSelectedDayToday }: DailyTotalsCardProps) {
  const fraction = isSelectedDayToday
    ? getTimeBudgetFraction(new Date(), schedule)
    : 1;

  const budgetCalories = goals != null ? goals.calories * fraction : null;
  const budgetProtein = goals != null ? goals.protein * fraction : null;
  const budgetFiber = goals != null ? goals.fiber * fraction : null;

  const KCAL_PER_GRAM_FAT = 9;
  const satFatMode = goals?.saturatedFatMode ?? "grams";
  const satFatDailyGrams = goals != null
    ? satFatMode === "percentage"
      ? (goals.calories * goals.saturatedFat / 100) / KCAL_PER_GRAM_FAT
      : goals.saturatedFat
    : null;
  const budgetSatFat = satFatDailyGrams != null ? satFatDailyGrams * fraction : null;
  const expectedTotals = addNutritionValues(totals, budgetedTotals);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Daily Totals</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2 text-center">
          <MetricCell actual={totals.calories} budget={budgetCalories} dailyGoal={goals?.calories ?? null} unit="kcal" label="kcal" highlight />
          <MetricCell actual={totals.protein} budget={budgetProtein} dailyGoal={goals?.protein ?? null} unit="g" label="Protein" invertColor />
          <MetricCell actual={totals.saturatedFat} budget={budgetSatFat} dailyGoal={satFatDailyGrams} unit="g" label="Sat. Fat" />
          <MetricCell actual={totals.fiber} budget={budgetFiber} dailyGoal={goals?.fiber ?? null} unit="g" label="Fiber" aboveGoalIsGood />
        </div>
        {hasNutrition(budgetedTotals) && (
          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">Budgeted</span>
                <span className="text-right">
                  {Math.round(budgetedTotals.calories)} kcal · {formatNumber(budgetedTotals.protein)}g protein · {formatNumber(budgetedTotals.saturatedFat)}g sat fat · {formatNumber(budgetedTotals.fiber)}g fiber
                </span>
              </div>
            </div>
            <div className="rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-primary">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">Expected Daily Totals</span>
                <span className="text-right">
                  {Math.round(expectedTotals.calories)} kcal · {formatNumber(expectedTotals.protein)}g protein · {formatNumber(expectedTotals.saturatedFat)}g sat fat · {formatNumber(expectedTotals.fiber)}g fiber
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// DUPLICATED: also defined in AddEntryDialog.tsx
type InputMode = "grams" | "units";

interface FoodEntryCardProps {
  item: LogEntry;
  food: Food;
  isLocked: boolean;
  onRemove: () => void;
  onUpdate: (updates: { grams?: number; units?: number; notes?: string }) => void;
  onToggleBudgeted: () => void;
}

function FoodEntryCard({ item, food, isLocked, onRemove, onUpdate, onToggleBudgeted }: FoodEntryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("grams");
  const [editNotes, setEditNotes] = useState("");
  const editCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        editCardRef.current != null &&
        !editCardRef.current.contains(e.target as Node)
      ) {
        setIsEditing(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing]);

  const isUnitBased = food.nutritionPerUnit != null;
  const entryNutrition = nutritionForEntry(item, food);
  const gramsPerUnit = food.gramsPerUnit;
  const isBudgeted = item.isBudgeted === true;

  const unitCount = isUnitBased
    ? item.units
    : gramsPerUnit != null && item.grams % gramsPerUnit === 0
      ? item.grams / gramsPerUnit
      : null;

  const subtitle = isUnitBased
    ? `${item.units ?? 0} unit${(item.units ?? 0) !== 1 ? "s" : ""}`
    : unitCount != null
      ? `${unitCount} unit${unitCount !== 1 ? "s" : ""} (${item.grams}g)`
      : `${item.grams}g`;

  function startEditing() {
    if (isUnitBased) {
      setInputMode("units");
      setEditValue(String(item.units ?? 0));
    } else if (unitCount != null && gramsPerUnit != null) {
      setInputMode("units");
      setEditValue(String(unitCount));
    } else {
      setInputMode("grams");
      setEditValue(String(item.grams));
    }
    setEditNotes(item.notes ?? "");
    setIsEditing(true);
  }

  function commitEdit() {
    const parsed = parseFloat(editValue);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setIsEditing(false);
      return;
    }
    const trimmedNotes = editNotes.trim();
    const newNotes = trimmedNotes.length > 0 ? trimmedNotes : undefined;
    const notesChanged = newNotes !== (item.notes ?? undefined);

    if (isUnitBased) {
      if (parsed !== (item.units ?? 0) || notesChanged) {
        onUpdate({ grams: 0, units: parsed, notes: newNotes });
      }
    } else {
      const newGrams =
        inputMode === "units" && gramsPerUnit != null
          ? parsed * gramsPerUnit
          : parsed;
      if (newGrams !== item.grams || notesChanged) {
        onUpdate({ grams: newGrams, notes: newNotes });
      }
    }
    setIsEditing(false);
  }

  function switchMode(mode: InputMode) {
    const parsed = parseFloat(editValue);
    if (!Number.isNaN(parsed) && parsed > 0 && gramsPerUnit != null) {
      setEditValue(
        String(mode === "units" ? parsed / gramsPerUnit : parsed * gramsPerUnit),
      );
    }
    setInputMode(mode);
  }

  const foodImage =
    food.imageUrl != null ? (
      <img
        src={food.imageUrl}
        alt={food.name}
        className="h-10 w-10 rounded-lg object-cover"
      />
    ) : (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-sm">
        🍽️
      </div>
    );

  if (isEditing) {
    return (
      <Card ref={editCardRef}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            {foodImage}
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {food.name}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
          {!isUnitBased && gramsPerUnit != null && (
            <div className="mt-2 flex gap-2">
              <button
                className={`flex-1 rounded-lg border px-3 py-1 text-xs transition-colors ${
                  inputMode === "grams"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-accent"
                }`}
                onClick={() => switchMode("grams")}
              >
                Grams
              </button>
              <button
                className={`flex-1 rounded-lg border px-3 py-1 text-xs transition-colors ${
                  inputMode === "units"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-accent"
                }`}
                onClick={() => switchMode("units")}
              >
                Units ({gramsPerUnit}g)
              </button>
            </div>
          )}
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              commitEdit();
            }}
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="h-8 text-sm"
                step="any"
                autoFocus
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {inputMode === "grams" ? "g" : "units"}
              </span>
              <Button type="submit" size="sm" className="h-8 shrink-0">
                Save
              </Button>
            </div>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Add a note…"
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={2}
            />
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`transition-colors ${isBudgeted ? "border-amber-500/40 bg-amber-500/5" : ""} ${isLocked ? "" : "cursor-pointer hover:bg-accent/50"}`}
      onClick={isLocked ? undefined : startEditing}
      onContextMenu={
        isLocked
          ? undefined
          : (e) => {
              e.preventDefault();
              onToggleBudgeted();
            }
      }
    >
      <CardContent className="flex items-center gap-3 p-3">
        {foodImage}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{food.name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs text-muted-foreground">{subtitle}</p>
            {isBudgeted && (
              <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                Budgeted
              </Badge>
            )}
          </div>
          {item.notes != null && item.notes.length > 0 && (
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground italic">
              <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{item.notes}</span>
            </p>
          )}
        </div>
        {!isLocked && (
          <Button
            variant={isBudgeted ? "outline" : "ghost"}
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={isBudgeted ? "Mark as consumed" : "Mark as budgeted"}
            title={isBudgeted ? "Mark as consumed" : "Mark as budgeted"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleBudgeted();
            }}
          >
            {isBudgeted ? (
              <Utensils className="h-3.5 w-3.5" />
            ) : (
              <CalendarCheck className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <div className="text-right text-xs">
          <p className="font-medium text-primary">
            {Math.round(entryNutrition.calories)} kcal
          </p>
          <p className="text-muted-foreground">
            {entryNutrition.protein}g prot
          </p>
        </div>
        {!isLocked && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface QuickAddEntryCardProps {
  item: QuickAddEntry;
  isLocked: boolean;
  onRemove: () => void;
  onUpdate: (updates: Partial<Omit<QuickAddEntry, "id" | "type">>) => void;
  onToggleBudgeted: () => void;
}

function QuickAddEntryCard({ item, isLocked, onRemove, onUpdate, onToggleBudgeted }: QuickAddEntryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCalories, setEditCalories] = useState("");
  const [editProtein, setEditProtein] = useState("");
  const [editSaturatedFat, setEditSaturatedFat] = useState("");
  const [editFiber, setEditFiber] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const editCardRef = useRef<HTMLDivElement>(null);
  const isBudgeted = item.isBudgeted === true;

  useEffect(() => {
    if (!isEditing) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        editCardRef.current != null &&
        !editCardRef.current.contains(e.target as Node)
      ) {
        setIsEditing(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isEditing]);

  function startEditing() {
    setEditName(item.name);
    setEditCalories(String(item.nutrition.calories));
    setEditProtein(String(item.nutrition.protein));
    setEditSaturatedFat(String(item.nutrition.saturatedFat));
    setEditFiber(String(item.nutrition.fiber));
    setEditNotes(item.notes ?? "");
    setIsEditing(true);
  }

  function parseEditValue(value: string): number {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }

  function commitEdit() {
    const trimmedName = editName.trim();
    if (trimmedName.length === 0) {
      setIsEditing(false);
      return;
    }

    const nutrition: NutritionValues = {
      calories: Math.round(parseEditValue(editCalories) * 10) / 10,
      protein: Math.round(parseEditValue(editProtein) * 10) / 10,
      saturatedFat: Math.round(parseEditValue(editSaturatedFat) * 10) / 10,
      fiber: Math.round(parseEditValue(editFiber) * 10) / 10,
    };
    const trimmedNotes = editNotes.trim();

    onUpdate({
      name: trimmedName,
      nutrition,
      notes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
    });
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <Card ref={editCardRef}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-xs font-medium">
              QA
            </div>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-8 min-w-0 flex-1 text-sm"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              commitEdit();
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                value={editCalories}
                onChange={(e) => setEditCalories(e.target.value)}
                className="h-8 text-sm"
                step="any"
                min="0"
                placeholder="kcal"
              />
              <Input
                type="number"
                value={editProtein}
                onChange={(e) => setEditProtein(e.target.value)}
                className="h-8 text-sm"
                step="any"
                min="0"
                placeholder="protein g"
              />
              <Input
                type="number"
                value={editSaturatedFat}
                onChange={(e) => setEditSaturatedFat(e.target.value)}
                className="h-8 text-sm"
                step="any"
                min="0"
                placeholder="sat fat g"
              />
              <Input
                type="number"
                value={editFiber}
                onChange={(e) => setEditFiber(e.target.value)}
                className="h-8 text-sm"
                step="any"
                min="0"
                placeholder="fiber g"
              />
            </div>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Add a note..."
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={2}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" className="h-8">
                Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`transition-colors ${isBudgeted ? "border-amber-500/40 bg-amber-500/5" : ""} ${isLocked ? "" : "cursor-pointer hover:bg-accent/50"}`}
      onClick={isLocked ? undefined : startEditing}
      onContextMenu={
        isLocked
          ? undefined
          : (e) => {
              e.preventDefault();
              onToggleBudgeted();
            }
      }
    >
      <CardContent className="flex items-center gap-3 p-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-xs font-medium">
          QA
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs text-muted-foreground">Quick add</p>
            {isBudgeted && (
              <Badge variant="warning" className="px-1.5 py-0 text-[10px]">
                Budgeted
              </Badge>
            )}
          </div>
          {item.notes != null && item.notes.length > 0 && (
            <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground italic">
              <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{item.notes}</span>
            </p>
          )}
        </div>
        {!isLocked && (
          <Button
            variant={isBudgeted ? "outline" : "ghost"}
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={isBudgeted ? "Mark as consumed" : "Mark as budgeted"}
            title={isBudgeted ? "Mark as consumed" : "Mark as budgeted"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleBudgeted();
            }}
          >
            {isBudgeted ? (
              <Utensils className="h-3.5 w-3.5" />
            ) : (
              <CalendarCheck className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        <div className="text-right text-xs">
          <p className="font-medium text-primary">
            {Math.round(item.nutrition.calories)} kcal
          </p>
          <p className="text-muted-foreground">
            {formatNumber(item.nutrition.protein)}g prot
          </p>
        </div>
        {!isLocked && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface WeightInputProps {
  weightKg: number | undefined;
  expectedWeightKg: number | null;
  isLocked: boolean;
  onSave: (weightKg: number | undefined) => void;
}

function WeightInput({ weightKg, expectedWeightKg, isLocked, onSave }: WeightInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  function startEditing() {
    setEditValue(weightKg != null ? String(weightKg) : "");
    setIsEditing(true);
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed === "") {
      onSave(undefined);
    } else {
      const parsed = parseFloat(trimmed);
      if (!Number.isNaN(parsed) && parsed > 0) {
        onSave(Math.round(parsed * 10) / 10);
      }
    }
    setIsEditing(false);
  }

  if (isEditing) {
    return (
      <Card className="mb-4">
        <CardContent className="p-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              commitEdit();
            }}
          >
            <Weight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="e.g. 75.2"
              className="h-8 text-sm"
              step="0.1"
              min="0"
              autoFocus
            />
            <span className="shrink-0 text-xs text-muted-foreground">kg</span>
            <Button type="submit" size="sm" className="h-8 shrink-0">
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => setIsEditing(false)}
            >
              Cancel
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const delta = weightKg != null && expectedWeightKg != null
    ? weightKg - expectedWeightKg
    : null;

  return (
    <Card
      className={`mb-4 transition-colors ${isLocked ? "" : "cursor-pointer hover:bg-accent/50"}`}
      onClick={isLocked ? undefined : startEditing}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <Weight className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Weight</span>
          {weightKg != null ? (
            <span className="ml-auto text-sm font-medium">{weightKg} kg</span>
          ) : (
            <span className="ml-auto text-xs text-muted-foreground">
              {isLocked ? "—" : "Tap to log"}
            </span>
          )}
        </div>
        {expectedWeightKg != null && (
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingDown className="h-3 w-3 shrink-0" />
            <span>Expected: {expectedWeightKg.toFixed(1)} kg</span>
            {delta != null && (
              <span className={`ml-auto font-medium ${delta > 0 ? "text-red-500" : "text-emerald-600"}`}>
                {delta > 0 ? "+" : ""}{delta.toFixed(1)} kg
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DailyLog({ appData }: DailyLogProps) {
  const navigate = useNavigate();
  const {
    activeProfile,
    foodsMap,
    addSeparator,
    removeLogEntry,
    reorderLogEntries,
    updateLogEntry,
    updateQuickAddEntry,
    updateDayLogWeight,
  } = appData;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [unlockedDates, setUnlockedDates] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<LogEntryId>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingAction | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const goToToday = useCallback(() => setSelectedDate(new Date()), []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;

      if (e.key === "t" || e.key === "T") {
        goToToday();
      } else if (e.key === "ArrowLeft") {
        setSelectedDate((prev) => subDays(prev, 1));
      } else if (e.key === "ArrowRight") {
        setSelectedDate((prev) => addDays(prev, 1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToToday]);

  useEffect(() => {
    if (!copyMenuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        copyMenuRef.current != null &&
        !copyMenuRef.current.contains(event.target as Node)
      ) {
        setCopyMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [copyMenuOpen]);

  useEffect(() => {
    if (copyFeedback == null) return;
    const timeout = window.setTimeout(() => setCopyFeedback(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  const dateStr = formatDate(selectedDate);
  const isLocked = !isToday(selectedDate) && !unlockedDates.has(dateStr);

  function toggleLock() {
    setUnlockedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) {
        next.delete(dateStr);
      } else {
        next.add(dateStr);
      }
      return next;
    });
  }

  const dayLog = useMemo(() => {
    if (activeProfile == null) return undefined;
    return activeProfile.dayLogs.find((dl) => dl.date === dateStr);
  }, [activeProfile, dateStr]);

  const entryIds = useMemo(
    () => dayLog?.entries.map((e) => e.id) ?? [],
    [dayLog],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over == null || active.id === over.id || dayLog == null) return;

    const oldIndex = dayLog.entries.findIndex((e) => e.id === active.id);
    const newIndex = dayLog.entries.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(dayLog.entries, oldIndex, newIndex);
    reorderLogEntries(activeProfile!.id, dateStr, reordered);
  }

  const totals = useMemo(() => {
    if (dayLog == null) {
      return { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 };
    }
    return sumNutrition(dayLog.entries, foodsMap, { status: "consumed" });
  }, [dayLog, foodsMap]);

  const budgetedTotals = useMemo(() => {
    if (dayLog == null) {
      return { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 };
    }
    return sumNutrition(dayLog.entries, foodsMap, { status: "budgeted" });
  }, [dayLog, foodsMap]);

  const selectedExpectedWeightKg = useMemo(
    () =>
      activeProfile?.weightLossPlan != null
        ? computeExpectedWeight(activeProfile.weightLossPlan, dateStr)
        : null,
    [activeProfile?.weightLossPlan, dateStr],
  );

  const copyThisDayMarkdown = useMemo(
    () => buildMarkdownForDay(dayLog, foodsMap, selectedExpectedWeightKg, dateStr),
    [dayLog, foodsMap, selectedExpectedWeightKg, dateStr],
  );

  const copyLastSevenDaysMarkdown = useMemo(() => {
    if (activeProfile == null) return "";

    const lines = [`# ${activeProfile.name} log summary`, ""];

    for (let offset = 6; offset >= 0; offset--) {
      const dayDate = subDays(selectedDate, offset);
      const dayDateStr = formatDate(dayDate);
      const day = activeProfile.dayLogs.find((entry) => entry.date === dayDateStr);
      const expectedWeight =
        activeProfile.weightLossPlan != null
          ? computeExpectedWeight(activeProfile.weightLossPlan, dayDateStr)
          : null;

      lines.push(buildMarkdownForDay(day, foodsMap, expectedWeight, dayDateStr));
      if (offset !== 0) {
        lines.push("");
      }
    }

    return lines.join("\n");
  }, [activeProfile, foodsMap, selectedDate]);

  const writeToClipboard = useCallback(async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(successMessage);
      setCopyMenuOpen(false);
    } catch {
      setCopyFeedback("Clipboard copy failed");
    }
  }, []);

  const sectionSubtotals = useMemo(() => {
    if (dayLog == null) return new Map<LogEntryId, NutritionValues>();
    const result = new Map<LogEntryId, NutritionValues>();
    let currentSeparatorId: LogEntryId | null = null;
    let currentItems: Array<LogEntry | QuickAddEntry> = [];

    function flushSection() {
      if (currentSeparatorId != null && currentItems.length > 0) {
        result.set(currentSeparatorId, sumNutrition(currentItems, foodsMap, { status: "consumed" }));
      }
      currentItems = [];
    }

    for (const item of dayLog.entries) {
      if (item.type === "separator") {
        flushSection();
        currentSeparatorId = item.id as LogEntryId;
      } else {
        currentItems.push(item);
      }
    }
    flushSection();

    return result;
  }, [dayLog, foodsMap]);

  if (activeProfile == null) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="mb-3">
              No profile selected. Create one to start tracking.
            </p>
            <Button onClick={() => navigate("/profiles")}>
              Go to Profiles
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Date navigation */}
      <div className="mb-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSelectedDate(subDays(selectedDate, 1))}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="text-center">
          <button
            className="text-lg font-bold hover:text-primary"
            onClick={goToToday}
          >
            {format(selectedDate, "EEE, MMM d")}
          </button>
          {isToday(selectedDate) && (
            <Badge variant="success" className="ml-2">
              Today
            </Badge>
          )}
          {!isToday(selectedDate) && (
            <button
              className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground"
              onClick={toggleLock}
              aria-label={isLocked ? "Unlock this day for editing" : "Lock this day to prevent edits"}
            >
              {isLocked ? (
                <Lock className="h-4 w-4" />
              ) : (
                <LockOpen className="h-4 w-4" />
              )}
            </button>
          )}
          <p className="text-xs text-muted-foreground">
            {activeProfile.name}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {!isToday(selectedDate) && (
        <div className="mb-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={goToToday}>
            Go to Today
          </Button>
        </div>
      )}

      {/* Daily totals */}
      <DailyTotalsCard
        totals={totals}
        budgetedTotals={budgetedTotals}
        goals={activeProfile.goals ?? null}
        schedule={activeProfile.schedule ?? null}
        isSelectedDayToday={isToday(selectedDate)}
      />

      {/* Weight */}
      <WeightInput
        weightKg={dayLog?.weightKg}
        expectedWeightKg={selectedExpectedWeightKg}
        isLocked={isLocked}
        onSave={(w) => updateDayLogWeight(activeProfile.id, dateStr, w)}
      />

      {/* Entries list */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <h2 className="font-semibold">Entries</h2>
          {sectionSubtotals.size > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const allSeparatorIds = [...sectionSubtotals.keys()];
                const allCollapsed = allSeparatorIds.every((id) => collapsedSections.has(id));
                setCollapsedSections(allCollapsed ? new Set() : new Set(allSeparatorIds));
              }}
            >
              {[...sectionSubtotals.keys()].every((id) => collapsedSections.has(id)) ? (
                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronsDownUp className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={copyMenuRef}>
            <div className="flex">
              <Button
                size="sm"
                variant="outline"
                className="rounded-r-none border-r-0"
                onClick={() => void writeToClipboard(copyThisDayMarkdown, "Copied this day")}
              >
                <Copy className="mr-1 h-4 w-4" />
                Copy this day
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-l-none px-2"
                aria-label="More copy options"
                onClick={() => setCopyMenuOpen((prev) => !prev)}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
            {copyMenuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border bg-popover p-1 shadow-lg">
                <button
                  className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => void writeToClipboard(copyLastSevenDaysMarkdown, "Copied last 7 days")}
                >
                  Copy last 7 days
                </button>
              </div>
            )}
          </div>
          {copyFeedback != null && (
            <span className="text-xs text-muted-foreground">{copyFeedback}</span>
          )}
        {!isLocked && (
        <div className="flex gap-2">
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSectionMenuOpen(!sectionMenuOpen)}
            >
              Section
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
            {sectionMenuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border bg-popover p-2 shadow-lg">
                {SEPARATOR_PRESETS.map((label) => (
                  <button
                    key={label}
                    className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      addSeparator(
                        activeProfile.id as ProfileId,
                        dateStr,
                        label,
                      );
                      setSectionMenuOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <div className="mt-1 border-t pt-1">
                  <form
                    className="flex gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = customLabel.trim();
                      if (trimmed.length === 0) return;
                      addSeparator(
                        activeProfile.id as ProfileId,
                        dateStr,
                        trimmed,
                      );
                      setCustomLabel("");
                      setSectionMenuOpen(false);
                    }}
                  >
                    <Input
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="Custom…"
                      className="h-7 text-sm"
                      autoFocus
                    />
                    <Button type="submit" size="sm" className="h-7 px-2">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </div>
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add Entry
          </Button>
        </div>
        )}
        </div>
      </div>

      {(dayLog == null || dayLog.entries.length === 0) && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No entries for this day yet.
          </CardContent>
        </Card>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {dayLog?.entries.map((item, index) => {
              const nextItem = dayLog.entries[index + 1];
              const isLastBeforeNextSection = nextItem?.type === "separator" || index === dayLog.entries.length - 1;
              const showSubtotal = item.type !== "separator" && isLastBeforeNextSection;

              let currentSeparatorId: LogEntryId | null = null;
              for (let i = index; i >= 0; i--) {
                const prev = dayLog.entries[i];
                if (prev.type === "separator") {
                  currentSeparatorId = prev.id as LogEntryId;
                  break;
                }
              }
              const subtotal = showSubtotal && currentSeparatorId != null
                ? sectionSubtotals.get(currentSeparatorId)
                : undefined;

              const isCollapsed = currentSeparatorId != null && collapsedSections.has(currentSeparatorId);

              if (item.type === "separator") {
                const separatorId = item.id as LogEntryId;
                const sectionCollapsed = collapsedSections.has(separatorId);
                const sectionTotals = sectionSubtotals.get(separatorId);
                return (
                  <SortableItem key={item.id} item={item} isLocked={isLocked}>
                    <button
                      className="flex w-full items-center gap-2 pt-2 first:pt-0"
                      onClick={() =>
                        setCollapsedSections((prev) => {
                          const next = new Set(prev);
                          if (next.has(separatorId)) {
                            next.delete(separatorId);
                          } else {
                            next.add(separatorId);
                          }
                          return next;
                        })
                      }
                    >
                      <div className="h-px flex-1 bg-border" />
                      {sectionCollapsed ? (
                        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {item.label}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                      {!isLocked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete({
                              title: "Remove section",
                              description: `Remove the "${item.label}" section separator?`,
                              onConfirm: () =>
                                removeLogEntry(
                                  activeProfile.id as ProfileId,
                                  dateStr,
                                  item.id as LogEntryId,
                                ),
                            });
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      )}
                    </button>
                    {sectionCollapsed && sectionTotals != null && (
                      <SectionSubtotal totals={sectionTotals} />
                    )}
                  </SortableItem>
                );
              }

              if (isCollapsed) return null;

              if (item.type === "quick-add") {
                return (
                  <SortableItem key={item.id} item={item} isLocked={isLocked}>
                    <QuickAddEntryCard
                      item={item}
                      isLocked={isLocked}
                      onRemove={() =>
                        setPendingDelete({
                          title: "Remove entry",
                          description: `Remove "${item.name}" from this day's log?`,
                          onConfirm: () =>
                            removeLogEntry(
                              activeProfile.id as ProfileId,
                              dateStr,
                              item.id as LogEntryId,
                            ),
                        })
                      }
                      onUpdate={(updates) =>
                        updateQuickAddEntry(
                          activeProfile.id as ProfileId,
                          dateStr,
                          item.id as LogEntryId,
                          updates,
                        )
                      }
                      onToggleBudgeted={() =>
                        updateQuickAddEntry(
                          activeProfile.id as ProfileId,
                          dateStr,
                          item.id as LogEntryId,
                          { isBudgeted: item.isBudgeted === true ? undefined : true },
                        )
                      }
                    />
                    {subtotal != null && (
                      <SectionSubtotal totals={subtotal} />
                    )}
                  </SortableItem>
                );
              }

              const food = foodsMap.get(item.foodId);
              if (food == null) {
                return (
                  <SortableItem key={item.id} item={item} isLocked={isLocked}>
                    <Card className="border-dashed opacity-60">
                      <CardContent className="flex items-center gap-3 p-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">Deleted food</p>
                          <p className="text-xs text-muted-foreground">
                            This food no longer exists in your database
                          </p>
                        </div>
                        {!isLocked && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() =>
                              setPendingDelete({
                                title: "Remove entry",
                                description:
                                  "Remove this deleted food entry from the log?",
                                onConfirm: () =>
                                  removeLogEntry(
                                    activeProfile.id as ProfileId,
                                    dateStr,
                                    item.id as LogEntryId,
                                  ),
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                    {subtotal != null && (
                      <SectionSubtotal totals={subtotal} />
                    )}
                  </SortableItem>
                );
              }

              return (
                <SortableItem key={item.id} item={item} isLocked={isLocked}>
                  <FoodEntryCard
                    item={item}
                    food={food}
                    isLocked={isLocked}
                    onRemove={() =>
                      setPendingDelete({
                        title: "Remove entry",
                        description: `Remove "${food.name}" from this day's log?`,
                        onConfirm: () =>
                          removeLogEntry(
                            activeProfile.id as ProfileId,
                            dateStr,
                            item.id as LogEntryId,
                          ),
                      })
                    }
                    onUpdate={(updates) =>
                      updateLogEntry(
                        activeProfile.id as ProfileId,
                        dateStr,
                        item.id as LogEntryId,
                        updates,
                      )
                    }
                    onToggleBudgeted={() =>
                      updateLogEntry(
                        activeProfile.id as ProfileId,
                        dateStr,
                        item.id as LogEntryId,
                        { isBudgeted: item.isBudgeted === true ? undefined : true },
                      )
                    }
                  />
                  {subtotal != null && (
                    <SectionSubtotal totals={subtotal} />
                  )}
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <AddEntryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        appData={appData}
        profileId={activeProfile.id}
        date={dateStr}
      />

      <ConfirmDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
