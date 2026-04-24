import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type {
  AppData,
  Food,
  FoodId,
  NutritionGoals,
  Profile,
  ProfileId,
  DayLog,
  LogEntry,
  LogEntryId,
  DayLogItem,
  QuickAddEntry,
  SectionSeparator,
  UserMetrics,
  WakeSleepSchedule,
  WeightLossPlan,
} from "./types";
import { generateId } from "./types";
import { loadAppData, saveAppData, StorageQuotaError } from "./storage";
import { loadCloudData, saveCloudData } from "./cloudStorage";
import { mergeAppData } from "./mergeAppData";
import { useAuth } from "./auth";
import { builtinFoods } from "./data/builtinFoods";
import { buildResolvedFoodsMap } from "./nutrition";

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
  const [storageError, setStorageError] = useState<string | null>(null);
  const [cloudSynced, setCloudSynced] = useState(false);
  const cloudSaveInFlight = useRef(false);
  const pendingCloudSave = useRef<AppData | null>(null);
  const [cloudSyncing, setCloudSyncing] = useState(false);

  const flushCloudSave = useCallback(
    (uid: string, dataToSave: AppData) => {
      cloudSaveInFlight.current = true;
      setCloudSyncing(true);
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
            setCloudSyncing(false);
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

  const forceCloudSync = useCallback(() => {
    if (user == null) {
      console.warn("[cloud-sync] force sync skipped: no user");
      return;
    }
    console.log("[cloud-sync] force sync triggered");
    flushCloudSave(user.uid, data);
  }, [user, data, flushCloudSave]);

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
      persist({ ...data, foods: [...data.foods, newFood] });
      return newFood;
    },
    [data, persist],
  );

  const updateFood = useCallback(
    (foodId: FoodId, updates: Partial<Omit<Food, "id" | "createdAt">>) => {
      persist({
        ...data,
        foods: data.foods.map((f) =>
          f.id === foodId ? { ...f, ...updates } : f,
        ),
      });
    },
    [data, persist],
  );

  const deleteFood = useCallback(
    (foodId: FoodId) => {
      persist({
        ...data,
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
      });
    },
    [data, persist],
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
      };
      const next: AppData = {
        ...data,
        profiles: [...data.profiles, newProfile],
        activeProfileId:
          data.activeProfileId ?? newProfile.id,
      };
      persist(next);
      return newProfile;
    },
    [data, persist],
  );

  const setActiveProfile = useCallback(
    (profileId: ProfileId) => {
      persist({ ...data, activeProfileId: profileId });
    },
    [data, persist],
  );

  const deleteProfile = useCallback(
    (profileId: ProfileId) => {
      const remaining = data.profiles.filter((p) => p.id !== profileId);
      const nextActiveId =
        data.activeProfileId === profileId
          ? (remaining[0]?.id ?? null)
          : data.activeProfileId;
      persist({
        ...data,
        profiles: remaining,
        activeProfileId: nextActiveId,
      });
    },
    [data, persist],
  );

  const renameProfile = useCallback(
    (profileId: ProfileId, name: string) => {
      persist({
        ...data,
        profiles: data.profiles.map((p) =>
          p.id === profileId ? { ...p, name } : p,
        ),
      });
    },
    [data, persist],
  );

  const updateProfileGoals = useCallback(
    (
      profileId: ProfileId,
      goals: NutritionGoals | null,
      schedule: WakeSleepSchedule | null,
      userMetrics: UserMetrics | null,
    ) => {
      persist({
        ...data,
        profiles: data.profiles.map((p) =>
          p.id === profileId ? { ...p, goals, schedule, userMetrics } : p,
        ),
      });
    },
    [data, persist],
  );

  // --- Day log entries ---

  const appendToDayLog = useCallback(
    (profileId: ProfileId, date: string, item: DayLogItem) => {
      persist({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          const existingDay = p.dayLogs.find((dl) => dl.date === date);
          if (existingDay != null) {
            return {
              ...p,
              dayLogs: p.dayLogs.map((dl) =>
                dl.date === date
                  ? { ...dl, entries: [...dl.entries, item] }
                  : dl,
              ),
            };
          }
          const newDayLog: DayLog = { date, entries: [item] };
          return { ...p, dayLogs: [...p.dayLogs, newDayLog] };
        }),
      });
    },
    [data, persist],
  );

  const addLogEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entry: Omit<LogEntry, "id">,
    ) => {
      const newEntry: LogEntry = {
        ...entry,
        id: generateId() as LogEntryId,
      };
      appendToDayLog(profileId, date, newEntry);
    },
    [appendToDayLog],
  );

  const addSeparator = useCallback(
    (profileId: ProfileId, date: string, label: string) => {
      const separator: SectionSeparator = {
        type: "separator",
        id: generateId() as LogEntryId,
        label,
      };
      appendToDayLog(profileId, date, separator);
    },
    [appendToDayLog],
  );

  const addQuickAddEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entry: Omit<QuickAddEntry, "id">,
    ) => {
      const newEntry: QuickAddEntry = {
        ...entry,
        id: generateId() as LogEntryId,
      };
      appendToDayLog(profileId, date, newEntry);
    },
    [appendToDayLog],
  );

  const removeLogEntry = useCallback(
    (profileId: ProfileId, date: string, entryId: LogEntryId) => {
      persist({
        ...data,
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
      });
    },
    [data, persist],
  );

  const reorderLogEntries = useCallback(
    (profileId: ProfileId, date: string, newEntries: ReadonlyArray<DayLogItem>) => {
      persist({
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
      });
    },
    [data, persist],
  );

  const setWeightLossPlan = useCallback(
    (profileId: ProfileId, plan: WeightLossPlan | null) => {
      persist({
        ...data,
        profiles: data.profiles.map((p) =>
          p.id === profileId ? { ...p, weightLossPlan: plan } : p,
        ),
      });
    },
    [data, persist],
  );

  const updateDayLogWeight = useCallback(
    (profileId: ProfileId, date: string, weightKg: number | undefined) => {
      persist({
        ...data,
        profiles: data.profiles.map((p) => {
          if (p.id !== profileId) return p;
          const existingDay = p.dayLogs.find((dl) => dl.date === date);
          if (existingDay != null) {
            return {
              ...p,
              dayLogs: p.dayLogs.map((dl) =>
                dl.date === date ? { ...dl, weightKg } : dl,
              ),
            };
          }
          const newDayLog: DayLog = { date, entries: [], weightKg };
          return { ...p, dayLogs: [...p.dayLogs, newDayLog] };
        }),
      });
    },
    [data, persist],
  );

  const updateLogEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entryId: LogEntryId,
      updates: Partial<Omit<LogEntry, "id">>,
    ) => {
      persist({
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
      });
    },
    [data, persist],
  );

  const updateQuickAddEntry = useCallback(
    (
      profileId: ProfileId,
      date: string,
      entryId: LogEntryId,
      updates: Partial<Omit<QuickAddEntry, "id" | "type">>,
    ) => {
      persist({
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
      });
    },
    [data, persist],
  );

  return {
    data,
    allFoods,
    storageError,
    foodsMap,
    activeProfile,
    cloudSyncing,
    forceCloudSync,
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
    reorderLogEntries,
    updateLogEntry,
    updateQuickAddEntry,
    updateDayLogWeight,
    setWeightLossPlan,
    setStorageError,
  };
}
