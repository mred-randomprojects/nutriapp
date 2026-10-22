import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useSyncExternalStore,
} from "react";
import type {
  AppData,
  DeletedDayLogEntry,
  DeletedFood,
  DeletedProfile,
  Food,
  FoodId,
  NutritionGoals,
  Profile,
  ProfileId,
  DayLog,
  DaySignOff,
  LogEntry,
  LogEntryId,
  DayLogItem,
  MealPlanId,
  QuickAddEntry,
  SavedMealPlan,
  SectionSeparator,
  UserMetrics,
  WakeSleepSchedule,
  WeeklyMealPlan,
  WeightLossPlan,
} from "./types";
import { generateId } from "./types";
import { loadCloudData, writeCloudData } from "./cloudStorage";
import { SyncEngine, type CloudPort } from "./syncEngine";
import { indexedDbSafetyStore } from "./safetyStore";
import { builtinFoods } from "./data/builtinFoods";
import { buildResolvedFoodsMap } from "./nutrition";
import { upsertDeletedDayLogEntry } from "./deletedDayLogEntries";
import {
  upsertDeletedFood,
  upsertDeletedProfile,
} from "./deletedAppEntities";

export type { HistoryFrame, SaveStatus } from "./syncEngine";

const firestore: CloudPort = { load: loadCloudData, write: writeCloudData };

function logCloudSync(message: string, detail?: unknown): void {
  if (detail === undefined) console.log(`[cloud-sync] ${message}`);
  else console.error(`[cloud-sync] ${message}:`, detail);
}

function clonePlanEntries(entries: ReadonlyArray<DayLogItem>): DayLogItem[] {
  return entries.map((entry) => ({ ...entry }));
}

function removeFoodFromPlanEntries(
  entries: ReadonlyArray<DayLogItem>,
  foodId: FoodId,
): DayLogItem[] {
  return entries.filter(
    (entry) =>
      entry.type === "separator" ||
      entry.type === "quick-add" ||
      entry.foodId !== foodId,
  );
}

function removeFoodFromWeeklyPlan(
  plan: WeeklyMealPlan | undefined,
  foodId: FoodId,
): WeeklyMealPlan | undefined {
  if (plan == null) return plan;
  const next: WeeklyMealPlan = {};

  for (const key of Object.keys(plan)) {
    const weekday = Number(key) as keyof WeeklyMealPlan;
    const entries = plan[weekday] ?? [];
    next[weekday] = removeFoodFromPlanEntries(entries, foodId);
  }

  return next;
}

function removeFoodFromMealPlans(
  plans: ReadonlyArray<SavedMealPlan> | undefined,
  foodId: FoodId,
): SavedMealPlan[] | undefined {
  if (plans == null) return plans;
  return plans.map((plan) => ({
    ...plan,
    entries: removeFoodFromPlanEntries(plan.entries, foodId),
    updatedAt: new Date().toISOString(),
  }));
}

function makeBudgetedPlanEntries(entries: ReadonlyArray<DayLogItem>): DayLogItem[] {
  return entries.map((entry) => {
    if (entry.type === "separator") {
      return {
        ...entry,
        id: generateId() as LogEntryId,
      };
    }
    if (entry.type === "quick-add") {
      return {
        ...entry,
        id: generateId() as LogEntryId,
        isBudgeted: true,
      };
    }
    return {
      ...entry,
      id: generateId() as LogEntryId,
      isBudgeted: true,
    };
  });
}

function insertDayLogItem(
  entries: ReadonlyArray<DayLogItem>,
  item: DayLogItem,
  insertIndex?: number,
): DayLogItem[] {
  if (insertIndex == null) return [...entries, item];

  const safeIndex = Math.max(0, Math.min(insertIndex, entries.length));
  return [
    ...entries.slice(0, safeIndex),
    item,
    ...entries.slice(safeIndex),
  ];
}

/**
 * Central hook that owns all app state and persists to both
 * localStorage (immediate, offline-capable) and Firestore (async, cloud sync).
 * Every mutation returns a new AppData (immutable updates).
 * Built-in foods (from the bundle) are merged with user-defined foods
 * (from localStorage). Only user foods are persisted/editable.
 *
 * `uid` is the signed-in account. The local copy it reads and writes is that
 * account's own (see localKeysFor), so another account signed in on the same
 * browser never reaches it; App.tsx remounts the hook when the uid changes.
 * Persistence and sync live in SyncEngine; this hook turns user actions into
 * new AppData and hands them to it.
 */
export function useAppData(uid: string) {
  const [engine] = useState(
    () =>
      new SyncEngine({
        uid,
        cloud: firestore,
        log: logCloudSync,
        safety: indexedDbSafetyStore,
      }),
  );
  const { data, undoStack, redoStack, storageError, cloudError, saveStatus, safetyCopy } =
    useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  useEffect(() => {
    engine.start();
    function handleReturn() {
      if (document.visibilityState !== "visible") return;
      engine.notifyReturn();
    }
    function handleOnline() {
      engine.notifyOnline();
    }
    // Another tab of this browser wrote to localStorage (the browser never
    // reports a tab's own writes back to it).
    function handleStorage(event: StorageEvent) {
      if (event.storageArea !== window.localStorage) return;
      engine.handleStorageEvent(event.key, event.newValue);
    }
    window.addEventListener("focus", handleReturn);
    document.addEventListener("visibilitychange", handleReturn);
    window.addEventListener("online", handleOnline);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("focus", handleReturn);
      document.removeEventListener("visibilitychange", handleReturn);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("storage", handleStorage);
      engine.stop();
    };
  }, [engine]);

  /**
   * Applies a user-initiated mutation and records it as an undoable action.
   * All mutations funnel through here so the history captures everything and
   * undo/redo restore exact prior snapshots. Starting a new action clears the
   * redo stack, matching the standard linear-history model. `data` is what
   * the mutation was computed from, so the engine can replay it if a pull
   * landed in between.
   */
  const commit = useCallback(
    (next: AppData, label: string) => engine.commit(next, data, label),
    [engine, data],
  );

  const undo = useCallback(() => engine.undo(), [engine]);
  const redo = useCallback(() => engine.redo(), [engine]);
  const undoTo = useCallback((index: number) => engine.undoTo(index), [engine]);
  const setStorageError = useCallback(
    (message: string | null) => engine.setStorageError(message),
    [engine],
  );
  const isLocalCopyStored = useCallback(() => engine.localCopyStored, [engine]);
  const restoreSafetyCopy = useCallback(() => engine.restoreSafetyCopy(), [engine]);
  const dismissSafetyCopy = useCallback(() => engine.dismissSafetyCopy(), [engine]);

  const rawFoods = useMemo(
    () => [...builtinFoods, ...data.foods],
    [data.foods],
  );

  const foodsMap = useMemo(
    () => buildResolvedFoodsMap(rawFoods),
    [rawFoods],
  );

  const allFoods = useMemo(
    () => rawFoods.map((f) => foodsMap.get(f.id) ?? f),
    [rawFoods, foodsMap],
  );

  const activeProfile = useMemo(
    () =>
      data.activeProfileId == null
        ? undefined
        : data.profiles.find((p) => p.id === data.activeProfileId),
    [data.profiles, data.activeProfileId],
  );

  // --- Food CRUD ---

  const addFood = useCallback(
    (food: Omit<Food, "id" | "createdAt">) => {
      const newFood: Food = {
        ...food,
        id: generateId() as FoodId,
        createdAt: new Date().toISOString(),
      };
      commit(
        { ...data, foods: [...data.foods, newFood] },
        `Add food “${newFood.name}”`,
      );
      return newFood;
    },
    [data, commit],
  );

  const updateFood = useCallback(
    (foodId: FoodId, updates: Partial<Omit<Food, "id" | "createdAt">>) => {
      const name = data.foods.find((f) => f.id === foodId)?.name;
      commit(
        {
          ...data,
          foods: data.foods.map((f) =>
            f.id === foodId ? { ...f, ...updates } : f,
          ),
        },
        name != null ? `Edit food “${name}”` : "Edit food",
      );
    },
    [data, commit],
  );

  const deleteFood = useCallback(
    (foodId: FoodId) => {
      const name = data.foods.find((f) => f.id === foodId)?.name;
      const deletedFood: DeletedFood = {
        foodId,
        deletedAt: new Date().toISOString(),
      };
      commit({
        ...data,
        deletedFoods: upsertDeletedFood(data.deletedFoods ?? [], deletedFood),
        foods: data.foods
          .filter((f) => f.id !== foodId)
          .map((f) => {
            if (f.ingredients == null) return f;
            const filtered = f.ingredients.filter(
              (ing) => ing.foodId !== foodId,
            );
            if (filtered.length === f.ingredients.length) return f;
            return {
              ...f,
              ingredients: filtered.length > 0 ? filtered : null,
            };
          }),
        profiles: data.profiles.map((p) => ({
          ...p,
          mealPlans: removeFoodFromMealPlans(p.mealPlans, foodId),
          weeklyPlan: removeFoodFromWeeklyPlan(p.weeklyPlan, foodId),
          dayLogs: p.dayLogs.map((dl) => ({
            ...dl,
            entries: dl.entries.filter(
              (e) =>
                e.type === "separator" ||
                e.type === "quick-add" ||
                e.foodId !== foodId,
            ),
          })),
        })),
      }, name != null ? `Delete food “${name}”` : "Delete food");
    },
    [data, commit],
  );

  // --- Profile CRUD ---

  const addProfile = useCallback(
    (name: string) => {
      const newProfile: Profile = {
        id: generateId() as ProfileId,
        name,
        dayLogs: [],
        createdAt: new Date().toISOString(),
        goals: null,
        schedule: null,
        userMetrics: null,
        weightLossPlan: null,
        mealPlans: [],
        weeklyPlan: {},
      };
      const next: AppData = {
        ...data,
        profiles: [...data.profiles, newProfile],
        activeProfileId:
          data.activeProfileId ?? newProfile.id,
      };
      commit(next, `Add profile “${name}”`);
      return newProfile;
    },
    [data, commit],
  );

  const setActiveProfile = useCallback(
    (profileId: ProfileId) => {
      const name = data.profiles.find((p) => p.id === profileId)?.name;
      commit(
        { ...data, activeProfileId: profileId },
        name != null ? `Switch to “${name}”` : "Switch profile",
      );
    },
    [data, commit],
  );

  const deleteProfile = useCallback(
    (profileId: ProfileId) => {
      const deletedProfile: DeletedProfile = {
        profileId,
        deletedAt: new Date().toISOString(),
      };
      const remaining = data.profiles.filter((p) => p.id !== profileId);
      const nextActiveId =
        data.activeProfileId === profileId
          ? (remaining[0]?.id ?? null)
          : data.activeProfileId;
      const name = data.profiles.find((p) => p.id === profileId)?.name;
      commit({
        ...data,
        deletedProfiles: upsertDeletedProfile(
          data.deletedProfiles ?? [],
          deletedProfile,
        ),
        profiles: remaining,
        activeProfileId: nextActiveId,
      }, name != null ? `Delete profile “${name}”` : "Delete profile");
    },
    [data, commit],
  );

  const renameProfile = useCallback(
    (profileId: ProfileId, name: string) => {
      commit(
        {
          ...data,
          profiles: data.profiles.map((p) =>
            p.id === profileId ? { ...p, name } : p,
          ),
        },
        `Rename profile to “${name}”`,
      );
    },
    [data, commit],
  );

  const updateProfileGoals = useCallback(
    (
      profileId: ProfileId,
      goals: NutritionGoals | null,
      schedule: WakeSleepSchedule | null,
      userMetrics: UserMetrics | null,
    ) => {
      commit(
        {
          ...data,
          profiles: data.profiles.map((p) =>
            p.id === profileId ? { ...p, goals, schedule, userMetrics } : p,
          ),
        },
        "Update goals",
      );
    },
    [data, commit],
  );

  // --- Day log entries ---

  const appendToDayLog = useCallback(
    (
      profileId: ProfileId,
      date: string,
      item: DayLogItem,
      label: string,
      insertIndex?: number,
    ) => {
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          const existingDay = p.dayLogs.find((dl) => dl.date === date);
          if (existingDay != null) {
            return {
              ...p,
              dayLogs: p.dayLogs.map((dl) =>
                dl.date === date
                  ? {
                      ...dl,
                      entries: insertDayLogItem(dl.entries, item, insertIndex),
                    }
                  : dl,
              ),
            };
          }
          const newDayLog: DayLog = { date, entries: [item] };
          return { ...p, dayLogs: [...p.dayLogs, newDayLog] };
        }),
      }, label);
    },
    [data, commit],
  );

  const addLogEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entry: Omit<LogEntry, "id">,
      insertIndex?: number,
    ) => {
      const newEntry: LogEntry = {
        ...entry,
        id: generateId() as LogEntryId,
      };
      const foodName = allFoods.find((f) => f.id === entry.foodId)?.name;
      appendToDayLog(
        profileId,
        date,
        newEntry,
        foodName != null ? `Add ${foodName}` : "Add entry",
        insertIndex,
      );
    },
    [appendToDayLog, allFoods],
  );

  const addSeparator = useCallback(
    (
      profileId: ProfileId,
      date: string,
      label: string,
      insertIndex?: number,
    ) => {
      const separator: SectionSeparator = {
        type: "separator",
        id: generateId() as LogEntryId,
        label,
      };
      appendToDayLog(
        profileId,
        date,
        separator,
        `Add section “${label}”`,
        insertIndex,
      );
    },
    [appendToDayLog],
  );

  const addQuickAddEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entry: Omit<QuickAddEntry, "id">,
      insertIndex?: number,
    ) => {
      const newEntry: QuickAddEntry = {
        ...entry,
        id: generateId() as LogEntryId,
      };
      appendToDayLog(
        profileId,
        date,
        newEntry,
        `Quick add “${entry.name}”`,
        insertIndex,
      );
    },
    [appendToDayLog],
  );

  const removeLogEntry = useCallback(
    (profileId: ProfileId, date: string, entryId: LogEntryId) => {
      const deletedEntry: DeletedDayLogEntry = {
        profileId,
        date,
        entryId,
        deletedAt: new Date().toISOString(),
      };
      commit({
        ...data,
        deletedDayLogEntries: upsertDeletedDayLogEntry(
          data.deletedDayLogEntries ?? [],
          deletedEntry,
        ),
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            dayLogs: p.dayLogs.map((dl) =>
              dl.date === date
                ? {
                    ...dl,
                    entries: dl.entries.filter((e) => e.id !== entryId),
                  }
                : dl,
            ),
          };
        }),
      }, "Delete entry");
    },
    [data, commit],
  );

  const removeLogEntries = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entryIds: ReadonlyArray<LogEntryId>,
    ) => {
      const uniqueEntryIds = [...new Set(entryIds)];
      if (uniqueEntryIds.length === 0) return;

      const entryIdSet = new Set(uniqueEntryIds);
      const deletedAt = new Date().toISOString();
      const deletedEntries = uniqueEntryIds.map((entryId) => ({
        profileId,
        date,
        entryId,
        deletedAt,
      }));
      const nextDeletedDayLogEntries = deletedEntries.reduce(
        (deleted, deletedEntry) =>
          upsertDeletedDayLogEntry(deleted, deletedEntry),
        data.deletedDayLogEntries ?? [],
      );

      commit({
        ...data,
        deletedDayLogEntries: nextDeletedDayLogEntries,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            dayLogs: p.dayLogs.map((dl) =>
              dl.date === date
                ? {
                    ...dl,
                    entries: dl.entries.filter((e) => !entryIdSet.has(e.id)),
                  }
                : dl,
            ),
          };
        }),
      }, uniqueEntryIds.length === 1
        ? "Delete entry"
        : `Delete ${uniqueEntryIds.length} entries`);
    },
    [data, commit],
  );

  const reorderLogEntries = useCallback(
    (profileId: ProfileId, date: string, newEntries: ReadonlyArray<DayLogItem>) => {
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            dayLogs: p.dayLogs.map((dl) =>
              dl.date === date ? { ...dl, entries: [...newEntries] } : dl,
            ),
          };
        }),
      }, "Reorder entries");
    },
    [data, commit],
  );

  const setWeightLossPlan = useCallback(
    (profileId: ProfileId, plan: WeightLossPlan | null) => {
      commit(
        {
          ...data,
          profiles: data.profiles.map((p) =>
            p.id === profileId ? { ...p, weightLossPlan: plan } : p,
          ),
        },
        plan == null ? "Clear weight plan" : "Update weight plan",
      );
    },
    [data, commit],
  );

  const updateDayLogWeight = useCallback(
    (
      profileId: ProfileId,
      date: string,
      weightKg: number | undefined,
      weightNotes: string | undefined,
    ) => {
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          const existingDay = p.dayLogs.find((dl) => dl.date === date);
          if (existingDay != null) {
            return {
              ...p,
              dayLogs: p.dayLogs.map((dl) =>
                dl.date === date ? { ...dl, weightKg, weightNotes } : dl,
              ),
            };
          }
          const newDayLog: DayLog = { date, entries: [], weightKg, weightNotes };
          return { ...p, dayLogs: [...p.dayLogs, newDayLog] };
        }),
      }, weightKg == null ? "Clear weight" : "Update weight");
    },
    [data, commit],
  );

  const updateDaySignOff = useCallback(
    (profileId: ProfileId, date: string, signOff: DaySignOff | undefined) => {
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          const existingDay = p.dayLogs.find((dl) => dl.date === date);
          if (existingDay != null) {
            return {
              ...p,
              dayLogs: p.dayLogs.map((dl) =>
                dl.date === date ? { ...dl, signOff } : dl,
              ),
            };
          }
          const newDayLog: DayLog = { date, entries: [], signOff };
          return { ...p, dayLogs: [...p.dayLogs, newDayLog] };
        }),
      }, signOff == null ? "Clear day sign-off" : "Sign off day");
    },
    [data, commit],
  );

  const updateLogEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entryId: LogEntryId,
      updates: Partial<Omit<LogEntry, "id">>,
    ) => {
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            dayLogs: p.dayLogs.map((dl) =>
              dl.date === date
                ? {
                    ...dl,
                    entries: dl.entries.map((e) =>
                      e.type !== "separator" &&
                      e.type !== "quick-add" &&
                      e.id === entryId
                        ? { ...e, ...updates }
                        : e,
                    ),
                  }
                : dl,
            ),
          };
        }),
      }, "Edit entry");
    },
    [data, commit],
  );

  const updateQuickAddEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entryId: LogEntryId,
      updates: Partial<Omit<QuickAddEntry, "id" | "type">>,
    ) => {
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            dayLogs: p.dayLogs.map((dl) =>
              dl.date === date
                ? {
                    ...dl,
                    entries: dl.entries.map((e) =>
                      e.type === "quick-add" && e.id === entryId
                        ? { ...e, ...updates }
                        : e,
                    ),
                  }
                : dl,
            ),
          };
        }),
      }, "Edit quick add");
    },
    [data, commit],
  );

  const saveMealPlanFromDay = useCallback(
    (profileId: ProfileId, name: string, entries: ReadonlyArray<DayLogItem>) => {
      const trimmedName = name.trim();
      if (trimmedName.length === 0 || entries.length === 0) return;
      const now = new Date().toISOString();
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          const existingPlans = p.mealPlans ?? [];
          const existingIndex = existingPlans.findIndex(
            (plan) => plan.name.trim().toLowerCase() === trimmedName.toLowerCase(),
          );
          const nextPlan: SavedMealPlan = {
            id:
              existingIndex >= 0
                ? existingPlans[existingIndex].id
                : (generateId() as MealPlanId),
            name: trimmedName,
            entries: clonePlanEntries(entries),
            createdAt:
              existingIndex >= 0 ? existingPlans[existingIndex].createdAt : now,
            updatedAt: now,
          };
          const nextPlans =
            existingIndex >= 0
              ? existingPlans.map((plan, index) =>
                  index === existingIndex ? nextPlan : plan,
                )
              : [...existingPlans, nextPlan];
          return { ...p, mealPlans: nextPlans };
        }),
      }, `Save meal plan “${trimmedName}”`);
    },
    [data, commit],
  );

  const renameMealPlan = useCallback(
    (profileId: ProfileId, planId: MealPlanId, name: string) => {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) return false;

      const profile = data.profiles.find((p) => p.id === profileId);
      const existingPlans = profile?.mealPlans ?? [];
      const currentPlan = existingPlans.find((plan) => plan.id === planId);
      if (currentPlan == null) return false;

      const duplicatePlan = existingPlans.some(
        (plan) =>
          plan.id !== planId &&
          plan.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      );
      if (duplicatePlan) return false;

      if (currentPlan.name === trimmedName) return true;

      const now = new Date().toISOString();
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            mealPlans: (p.mealPlans ?? []).map((plan) =>
              plan.id === planId
                ? { ...plan, name: trimmedName, updatedAt: now }
                : plan,
            ),
          };
        }),
      }, `Rename meal plan to “${trimmedName}”`);
      return true;
    },
    [data, commit],
  );

  const updateMealPlan = useCallback(
    (
      profileId: ProfileId,
      planId: MealPlanId,
      updates: {
        name: string;
        description: string | undefined;
        entries: ReadonlyArray<DayLogItem>;
      },
    ): boolean => {
      const trimmedName = updates.name.trim();
      if (trimmedName.length === 0) return false;

      const profile = data.profiles.find((p) => p.id === profileId);
      const existingPlans = profile?.mealPlans ?? [];
      const currentPlan = existingPlans.find((plan) => plan.id === planId);
      if (currentPlan == null) return false;

      const duplicateName = existingPlans.some(
        (plan) =>
          plan.id !== planId &&
          plan.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      );
      if (duplicateName) return false;

      const trimmedDescription = updates.description?.trim();
      const now = new Date().toISOString();
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            mealPlans: (p.mealPlans ?? []).map((plan) =>
              plan.id === planId
                ? {
                    ...plan,
                    name: trimmedName,
                    description:
                      trimmedDescription != null && trimmedDescription.length > 0
                        ? trimmedDescription
                        : undefined,
                    entries: clonePlanEntries(updates.entries),
                    updatedAt: now,
                  }
                : plan,
            ),
          };
        }),
      }, `Edit meal plan “${trimmedName}”`);
      return true;
    },
    [data, commit],
  );

  const deleteMealPlan = useCallback(
    (profileId: ProfileId, planId: MealPlanId) => {
      const name = data.profiles
        .find((p) => p.id === profileId)
        ?.mealPlans?.find((plan) => plan.id === planId)?.name;
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          return {
            ...p,
            mealPlans: (p.mealPlans ?? []).filter((plan) => plan.id !== planId),
          };
        }),
      }, name != null ? `Delete meal plan “${name}”` : "Delete meal plan");
    },
    [data, commit],
  );

  const applyMealPlanToDay = useCallback(
    (profileId: ProfileId, planId: MealPlanId, date: string) => {
      const planName = data.profiles
        .find((p) => p.id === profileId)
        ?.mealPlans?.find((plan) => plan.id === planId)?.name;
      commit({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          const planEntries =
            p.mealPlans?.find((plan) => plan.id === planId)?.entries ?? [];
          if (planEntries.length === 0) return p;
          const entriesToAdd = makeBudgetedPlanEntries(planEntries);

          const existingDay = p.dayLogs.find((dl) => dl.date === date);
          if (existingDay != null) {
            return {
              ...p,
              dayLogs: p.dayLogs.map((dl) =>
                dl.date === date
                  ? { ...dl, entries: [...dl.entries, ...entriesToAdd] }
                  : dl,
              ),
            };
          }

          const newDayLog: DayLog = { date, entries: entriesToAdd };
          return { ...p, dayLogs: [...p.dayLogs, newDayLog] };
        }),
      }, planName != null ? `Apply meal plan “${planName}”` : "Apply meal plan");
    },
    [data, commit],
  );

  return {
    data,
    allFoods,
    storageError,
    cloudError,
    saveStatus,
    foodsMap,
    activeProfile,
    addFood,
    updateFood,
    deleteFood,
    addProfile,
    setActiveProfile,
    deleteProfile,
    renameProfile,
    updateProfileGoals,
    addLogEntry,
    addQuickAddEntry,
    addSeparator,
    removeLogEntry,
    removeLogEntries,
    reorderLogEntries,
    updateLogEntry,
    updateQuickAddEntry,
    saveMealPlanFromDay,
    renameMealPlan,
    updateMealPlan,
    deleteMealPlan,
    applyMealPlanToDay,
    updateDayLogWeight,
    updateDaySignOff,
    setWeightLossPlan,
    setStorageError,
    isLocalCopyStored,
    // --- What a pull removed from this device ---
    safetyCopy,
    restoreSafetyCopy,
    dismissSafetyCopy,
    // --- Undo/redo history ---
    undoStack,
    redoStack,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undo,
    redo,
    undoTo,
  };
}
