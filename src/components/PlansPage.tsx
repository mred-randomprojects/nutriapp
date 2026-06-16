import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, isValid, parseISO } from "date-fns";
import {
  AlertTriangle,
  CalendarCheck,
  Pencil,
  Plus,
  Trash2,
  Utensils,
} from "lucide-react";
import type {
  DayLogItem,
  Food,
  MealPlanId,
  NutritionValues,
  ProfileId,
  SavedMealPlan,
} from "../types";
import type { AppDataHandle } from "../appDataType";
import { sumNutrition } from "../nutrition";
import { normalizeForSearch } from "../search";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PendingAction } from "./ConfirmDialog";

interface PlansPageProps {
  appData: AppDataHandle;
}

function formatDateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatStoredDate(value: string): string {
  const parsed = parseISO(value);
  if (!isValid(parsed)) return "unknown";
  return format(parsed, "MMM d, yyyy");
}

function countMealRows(entries: ReadonlyArray<DayLogItem>): number {
  return entries.filter((entry) => entry.type !== "separator").length;
}

function countSections(entries: ReadonlyArray<DayLogItem>): number {
  return entries.filter((entry) => entry.type === "separator").length;
}

function countMissingFoods(
  entries: ReadonlyArray<DayLogItem>,
  foodsMap: ReadonlyMap<string, Food>,
): number {
  return entries.filter(
    (entry) =>
      entry.type !== "separator" &&
      entry.type !== "quick-add" &&
      foodsMap.get(entry.foodId) == null,
  ).length;
}

function getEntryName(
  entry: DayLogItem,
  foodsMap: ReadonlyMap<string, Food>,
): string | null {
  if (entry.type === "separator") return null;
  if (entry.type === "quick-add") return entry.name;
  return foodsMap.get(entry.foodId)?.name ?? "Deleted food";
}

function getPlanPreview(
  plan: SavedMealPlan,
  foodsMap: ReadonlyMap<string, Food>,
): string {
  const names = plan.entries
    .map((entry) => getEntryName(entry, foodsMap))
    .filter((name): name is string => name != null)
    .slice(0, 4);

  if (names.length === 0) return "Empty plan";
  const suffix = countMealRows(plan.entries) > names.length ? "..." : "";
  return `${names.join(" · ")}${suffix}`;
}

function PlanMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

function PlanNutritionMetrics({ totals }: { totals: NutritionValues }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <PlanMetric label="Calories" value={`${Math.round(totals.calories)}`} />
      <PlanMetric label="Protein" value={`${formatNumber(totals.protein)}g`} />
      <PlanMetric
        label="Sat Fat"
        value={`${formatNumber(totals.saturatedFat)}g`}
      />
      <PlanMetric label="Fiber" value={`${formatNumber(totals.fiber)}g`} />
    </div>
  );
}

export function PlansPage({ appData }: PlansPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    activeProfile,
    foodsMap,
    applyMealPlanToDay,
    deleteMealPlan,
    renameMealPlan,
  } = appData;
  const [pendingDelete, setPendingDelete] = useState<PendingAction | null>(null);
  const [renamePlan, setRenamePlan] = useState<SavedMealPlan | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const search = searchParams.get("q") ?? "";
  const mealPlans = useMemo(
    () => activeProfile?.mealPlans ?? [],
    [activeProfile?.mealPlans],
  );

  const filteredMealPlans = useMemo(() => {
    const normalizedSearch = normalizeForSearch(search);
    if (normalizedSearch.length === 0) return mealPlans;
    return mealPlans.filter((plan) =>
      normalizeForSearch(plan.name).includes(normalizedSearch),
    );
  }, [mealPlans, search]);

  const trimmedRename = renameValue.trim();
  const renameNameTaken =
    renamePlan != null &&
    mealPlans.some(
      (plan) =>
        plan.id !== renamePlan.id &&
        plan.name.trim().toLowerCase() === trimmedRename.toLowerCase(),
    );
  const renameMessage = renameNameTaken
    ? "Another plan already uses that name."
    : renameError;

  function setSearch(value: string) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value.trim().length > 0) {
          next.set("q", value);
        } else {
          next.delete("q");
        }
        return next;
      },
      { replace: true },
    );
  }

  function openRenameDialog(plan: SavedMealPlan) {
    setRenamePlan(plan);
    setRenameValue(plan.name);
    setRenameError(null);
  }

  function closeRenameDialog() {
    setRenamePlan(null);
    setRenameValue("");
    setRenameError(null);
  }

  function saveRename() {
    if (activeProfile == null || renamePlan == null) return;
    if (trimmedRename.length === 0 || renameNameTaken) return;

    const renamed = renameMealPlan(
      activeProfile.id as ProfileId,
      renamePlan.id as MealPlanId,
      trimmedRename,
    );

    if (!renamed) {
      setRenameError("This plan could not be renamed.");
      return;
    }

    closeRenameDialog();
  }

  function saveDayPath() {
    return `/log/${formatDateKey(new Date())}`;
  }

  function applyPlanToday(plan: SavedMealPlan) {
    if (activeProfile == null) return;
    const today = formatDateKey(new Date());
    applyMealPlanToDay(activeProfile.id as ProfileId, plan.id as MealPlanId, today);
    navigate(`/log/${today}`);
  }

  if (activeProfile == null) {
    return (
      <div className="p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold">Plans</h1>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No active profile selected.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mealPlans.length} saved for {activeProfile.name}
          </p>
        </div>
        <Button size="sm" onClick={() => navigate(saveDayPath())}>
          <Plus className="mr-1 h-4 w-4" />
          Save
        </Button>
      </div>

      {mealPlans.length > 0 && (
        <Input
          placeholder="Search plans..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4"
        />
      )}

      {mealPlans.length === 0 && (
        <Card>
          <CardContent className="space-y-4 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-secondary">
              <Utensils className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No saved plans yet.</p>
            <Button size="sm" onClick={() => navigate(saveDayPath())}>
              <Plus className="mr-1 h-4 w-4" />
              Save a Day
            </Button>
          </CardContent>
        </Card>
      )}

      {filteredMealPlans.length === 0 && mealPlans.length > 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No plans match &ldquo;{search}&rdquo;
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {filteredMealPlans.map((plan) => {
          const totals = sumNutrition(plan.entries, foodsMap);
          const mealRowCount = countMealRows(plan.entries);
          const sectionCount = countSections(plan.entries);
          const missingFoodCount = countMissingFoods(plan.entries, foodsMap);

          return (
            <Card key={plan.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CalendarCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold">
                      {plan.name}
                    </h2>
                    <p className="truncate text-xs text-muted-foreground">
                      {getPlanPreview(plan, foodsMap)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated {formatStoredDate(plan.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Rename plan"
                      aria-label={`Rename ${plan.name}`}
                      onClick={() => openRenameDialog(plan)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete plan"
                      aria-label={`Delete ${plan.name}`}
                      onClick={() =>
                        setPendingDelete({
                          title: "Delete plan",
                          description: `Delete "${plan.name}" from all devices?`,
                          confirmLabel: "Delete from all devices",
                          onConfirm: () =>
                            deleteMealPlan(
                              activeProfile.id as ProfileId,
                              plan.id as MealPlanId,
                            ),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <PlanNutritionMetrics totals={totals} />

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {mealRowCount} item{mealRowCount !== 1 && "s"}
                  </Badge>
                  {sectionCount > 0 && (
                    <Badge variant="secondary">
                      {sectionCount} section{sectionCount !== 1 && "s"}
                    </Badge>
                  )}
                  {missingFoodCount > 0 && (
                    <Badge variant="warning" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {missingFoodCount} missing
                    </Badge>
                  )}
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  disabled={plan.entries.length === 0}
                  onClick={() => applyPlanToday(plan)}
                >
                  <CalendarCheck className="mr-1 h-4 w-4" />
                  Apply Today
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={renamePlan != null}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Plan</DialogTitle>
            <DialogDescription>
              Keep the saved entries and change only the plan name.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveRename();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Name</Label>
              <Input
                id="plan-name"
                value={renameValue}
                onChange={(event) => {
                  setRenameValue(event.target.value);
                  setRenameError(null);
                }}
                autoFocus
              />
            </div>
            {renameMessage != null && (
              <p className="text-sm text-destructive">{renameMessage}</p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={trimmedRename.length === 0 || renameNameTaken}
            >
              Save Name
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
