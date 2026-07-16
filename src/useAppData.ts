import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
import { loadAppData, saveAppData, StorageQuotaError } from "./storage";
import { loadCloudData, saveCloudData } from "./cloudStorage";
import { mergeAppData } from "./mergeAppData";
import { reconcileTombstonesForRestore } from "./tombstones";
import { useAuth } from "./auth";
import { builtinFoods } from "./data/builtinFoods";
import { buildResolvedFoodsMap } from "./nutrition";
import { upsertDeletedDayLogEntry } from "./deletedDayLogEntries";
import {
  upsertDeletedFood,
  upsertDeletedProfile,
} from "./deletedAppEntities";

/** Maximum number of undoable actions kept in the session history. */
const MAX_HISTORY = 50;

/**
 * One undoable action. `before`/`after` are full immutable AppData snapshots;
 * thanks to the immutable update style they structurally share everything the
 * action did not touch, so keeping many frames is cheap.
 */
export interface HistoryFrame {
  label: string;
  at: string;
  before: AppData;
  after: AppData;
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
 */
export function useAppData() {
  const { user } = useAuth();
  const [data, setData] = useState<AppData>(loadAppData);
  const [undoStack, setUndoStack] = useState<HistoryFrame[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryFrame[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [cloudSynced, setCloudSynced] = useState(false);
  const cloudSaveInFlight = useRef(false);
  const pendingCloudSave = useRef<AppData | null>(null);

  const flushCloudSave = useCallback(
    (uid: string, dataToSave: AppData) => {
      cloudSaveInFlight.current = true;
      console.log("[cloud-sync] save started");
      saveCloudData(uid, dataToSave)
        .then(() => {
          console.log("[cloud-sync] save succeeded");
        })
        .catch((err: unknown) => {
          console.error("[cloud-sync] save failed:", err);
        })
        .finally(() => {
          const queued = pendingCloudSave.current;
          pendingCloudSave.current = null;
          if (queued != null) {
            console.log("[cloud-sync] flushing queued save");
            flushCloudSave(uid, queued);
          } else {
            cloudSaveInFlight.current = false;
          }
        });
    },
    [],
  );

  useEffect(() => {
    if (user == null || cloudSynced) return;

    let cancelled = false;
    console.log("[cloud-sync] initial load started");
    loadCloudData(user.uid)
      .then((cloudData) => {
        if (cancelled) return;
        const local = loadAppData();
        if (cloudData != null) {
          console.log("[cloud-sync] cloud data found, merging with local");
          const merged = mergeAppData(local, cloudData);
          setData(merged);
          // Any undo frames captured before this point reference pre-merge
          // snapshots; undoing to one would drop the just-merged cloud data.
          // Drop the session history so undo can never clobber the merge.
          setUndoStack([]);
          setRedoStack([]);
          saveAppData(merged);
          saveCloudData(user.uid, merged)
            .then(() => console.log("[cloud-sync] initial merge pushed to cloud"))
            .catch((err: unknown) => console.error("[cloud-sync] initial merge push failed:", err));
        } else {
          console.log("[cloud-sync] no cloud data, uploading local");
          saveCloudData(user.uid, local)
            .then(() => console.log("[cloud-sync] initial upload succeeded"))
            .catch((err: unknown) => console.error("[cloud-sync] initial upload failed:", err));
        }
        setCloudSynced(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[cloud-sync] initial load failed:", err);
        setCloudSynced(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, cloudSynced]);

  const persist = useCallback(
    (next: AppData) => {
      try {
        saveAppData(next);
        setData(next);
        setStorageError(null);
      } catch (e) {
        if (e instanceof StorageQuotaError) {
          setStorageError(e.message);
        } else {
          throw e;
        }
      }

      if (user != null) {
        if (cloudSaveInFlight.current) {
          console.log("[cloud-sync] save in flight, queuing latest state");
          pendingCloudSave.current = next;
        } else {
          flushCloudSave(user.uid, next);
        }
      }
    },
    [user, flushCloudSave],
  );

  /**
   * Applies a user-initiated mutation and records it as an undoable action.
   * All mutations funnel through here so the history captures everything and
   * undo/redo restore exact prior snapshots. Starting a new action clears the
   * redo stack, matching the standard linear-history model.
   */
  const commit = useCallback(
    (next: AppData, label: string) => {
      const frame: HistoryFrame = {
        label,
        at: new Date().toISOString(),
        before: data,
        after: next,
      };
      setUndoStack((prev) => [...prev, frame].slice(-MAX_HISTORY));
      setRedoStack([]);
      persist(next);
    },
    [data, persist],
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const frame = undoStack[undoStack.length - 1];
    const now = new Date().toISOString();
    const restored = reconcileTombstonesForRestore(frame.before, data, now);
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack((prev) => [...prev, frame].slice(-MAX_HISTORY));
    persist(restored);
  }, [undoStack, data, persist]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const frame = redoStack[redoStack.length - 1];
    const now = new Date().toISOString();
    const restored = reconcileTombstonesForRestore(frame.after, data, now);
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack((prev) => [...prev, frame].slice(-MAX_HISTORY));
    persist(restored);
  }, [redoStack, data, persist]);

  /**
   * Undoes every action from the top of the stack down to and including the
   * frame at `index` in a single step. The undone frames are pushed onto the
   * redo stack newest-first so a subsequent redo replays them oldest-first,
   * one action at a time.
   */
  const undoTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= undoStack.length) return;
      const target = undoStack[index];
      const now = new Date().toISOString();
      const restored = reconcileTombstonesForRestore(target.before, data, now);
      const undone = undoStack.slice(index);
      setUndoStack(undoStack.slice(0, index));
      setRedoStack((prev) =>
        [...prev, ...undone.slice().reverse()].slice(-MAX_HISTORY),
      );
      persist(restored);
    },
    [undoStack, data, persist],
  );

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
    setWeightLossPlan,
    setStorageError,
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
