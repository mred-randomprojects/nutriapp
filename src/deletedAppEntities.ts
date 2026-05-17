import type {
  AppData,
  DayLog,
  DayLogItem,
  DeletedFood,
  DeletedProfile,
  Food,
  FoodId,
  Profile,
  ProfileId,
  SavedMealPlan,
  WeeklyMealPlan,
} from "./types";
import {
  buildDeletedDayLogEntrySet,
  deletedDayLogEntryKey,
} from "./deletedDayLogEntries";

export function deletedFoodKey(foodId: FoodId): string {
  return foodId;
}

export function deletedProfileKey(profileId: ProfileId): string {
  return profileId;
}

export function buildDeletedFoodSet(
  deletedFoods: ReadonlyArray<DeletedFood>,
): Set<string> {
  return new Set(
    deletedFoods.map((deletedFood) =>
      deletedFoodKey(deletedFood.foodId),
    ),
  );
}

export function buildDeletedProfileSet(
  deletedProfiles: ReadonlyArray<DeletedProfile>,
): Set<string> {
  return new Set(
    deletedProfiles.map((deletedProfile) =>
      deletedProfileKey(deletedProfile.profileId),
    ),
  );
}

export function mergeDeletedFoods(
  localDeletedFoods: ReadonlyArray<DeletedFood>,
  cloudDeletedFoods: ReadonlyArray<DeletedFood>,
): DeletedFood[] {
  const byKey = new Map<string, DeletedFood>();

  for (const deletedFood of [...localDeletedFoods, ...cloudDeletedFoods]) {
    const key = deletedFoodKey(deletedFood.foodId);
    const existing = byKey.get(key);
    if (existing == null || deletedFood.deletedAt > existing.deletedAt) {
      byKey.set(key, deletedFood);
    }
  }

  return [...byKey.values()];
}

export function mergeDeletedProfiles(
  localDeletedProfiles: ReadonlyArray<DeletedProfile>,
  cloudDeletedProfiles: ReadonlyArray<DeletedProfile>,
): DeletedProfile[] {
  const byKey = new Map<string, DeletedProfile>();

  for (const deletedProfile of [
    ...localDeletedProfiles,
    ...cloudDeletedProfiles,
  ]) {
    const key = deletedProfileKey(deletedProfile.profileId);
    const existing = byKey.get(key);
    if (existing == null || deletedProfile.deletedAt > existing.deletedAt) {
      byKey.set(key, deletedProfile);
    }
  }

  return [...byKey.values()];
}

export function upsertDeletedFood(
  deletedFoods: ReadonlyArray<DeletedFood>,
  deletedFood: DeletedFood,
): DeletedFood[] {
  const targetKey = deletedFoodKey(deletedFood.foodId);
  const next = deletedFoods.filter(
    (entry) => deletedFoodKey(entry.foodId) !== targetKey,
  );
  return [...next, deletedFood];
}

export function upsertDeletedProfile(
  deletedProfiles: ReadonlyArray<DeletedProfile>,
  deletedProfile: DeletedProfile,
): DeletedProfile[] {
  const targetKey = deletedProfileKey(deletedProfile.profileId);
  const next = deletedProfiles.filter(
    (entry) => deletedProfileKey(entry.profileId) !== targetKey,
  );
  return [...next, deletedProfile];
}

function filterDeletedFoodsFromFoods(
  foods: ReadonlyArray<Food>,
  deletedFoodSet: ReadonlySet<string>,
): Food[] {
  return foods
    .filter((food) => !deletedFoodSet.has(deletedFoodKey(food.id)))
    .map((food) => {
      if (food.ingredients == null) return food;
      const ingredients = food.ingredients.filter(
        (ingredient) =>
          !deletedFoodSet.has(deletedFoodKey(ingredient.foodId)),
      );
      if (ingredients.length === food.ingredients.length) return food;
      return {
        ...food,
        ingredients: ingredients.length > 0 ? ingredients : null,
      };
    });
}

function filterDeletedFoodsFromEntries(
  entries: ReadonlyArray<DayLogItem>,
  deletedFoodSet: ReadonlySet<string>,
): DayLogItem[] {
  return entries.filter(
    (entry) =>
      entry.type === "separator" ||
      entry.type === "quick-add" ||
      !deletedFoodSet.has(deletedFoodKey(entry.foodId)),
  );
}

function filterDeletedFoodsFromMealPlans(
  mealPlans: ReadonlyArray<SavedMealPlan> | undefined,
  deletedFoodSet: ReadonlySet<string>,
): SavedMealPlan[] | undefined {
  if (mealPlans == null) return mealPlans;
  return mealPlans.map((mealPlan) => ({
    ...mealPlan,
    entries: filterDeletedFoodsFromEntries(mealPlan.entries, deletedFoodSet),
  }));
}

function filterDeletedFoodsFromWeeklyPlan(
  weeklyPlan: WeeklyMealPlan | undefined,
  deletedFoodSet: ReadonlySet<string>,
): WeeklyMealPlan | undefined {
  if (weeklyPlan == null) return weeklyPlan;
  const next: WeeklyMealPlan = {};

  for (const key of Object.keys(weeklyPlan)) {
    const weekday = Number(key) as keyof WeeklyMealPlan;
    const entries = weeklyPlan[weekday] ?? [];
    next[weekday] = filterDeletedFoodsFromEntries(entries, deletedFoodSet);
  }

  return next;
}

function filterDeletedEntriesFromDayLog(
  profileId: ProfileId,
  dayLog: DayLog,
  deletedFoodSet: ReadonlySet<string>,
  deletedDayLogEntrySet: ReadonlySet<string>,
): DayLog {
  return {
    ...dayLog,
    entries: dayLog.entries.filter((entry) => {
      if (
        deletedDayLogEntrySet.has(
          deletedDayLogEntryKey(profileId, dayLog.date, entry.id),
        )
      ) {
        return false;
      }

      return (
        entry.type === "separator" ||
        entry.type === "quick-add" ||
        !deletedFoodSet.has(deletedFoodKey(entry.foodId))
      );
    }),
  };
}

function filterDeletedEntitiesFromProfiles(
  profiles: ReadonlyArray<Profile>,
  deletedProfileSet: ReadonlySet<string>,
  deletedFoodSet: ReadonlySet<string>,
  deletedDayLogEntrySet: ReadonlySet<string>,
): Profile[] {
  return profiles
    .filter((profile) => !deletedProfileSet.has(deletedProfileKey(profile.id)))
    .map((profile) => ({
      ...profile,
      mealPlans: filterDeletedFoodsFromMealPlans(
        profile.mealPlans,
        deletedFoodSet,
      ),
      weeklyPlan: filterDeletedFoodsFromWeeklyPlan(
        profile.weeklyPlan,
        deletedFoodSet,
      ),
      dayLogs: profile.dayLogs.map((dayLog) =>
        filterDeletedEntriesFromDayLog(
          profile.id,
          dayLog,
          deletedFoodSet,
          deletedDayLogEntrySet,
        ),
      ),
    }));
}

export function filterDeletedAppEntitiesFromAppData(data: AppData): AppData {
  const deletedDayLogEntries = data.deletedDayLogEntries ?? [];
  const deletedFoods = data.deletedFoods ?? [];
  const deletedProfiles = data.deletedProfiles ?? [];
  const deletedDayLogEntrySet = buildDeletedDayLogEntrySet(
    deletedDayLogEntries,
  );
  const deletedFoodSet = buildDeletedFoodSet(deletedFoods);
  const deletedProfileSet = buildDeletedProfileSet(deletedProfiles);
  const profiles = filterDeletedEntitiesFromProfiles(
    data.profiles,
    deletedProfileSet,
    deletedFoodSet,
    deletedDayLogEntrySet,
  );
  const activeProfileId =
    data.activeProfileId != null &&
    profiles.some((profile) => profile.id === data.activeProfileId)
      ? data.activeProfileId
      : (profiles[0]?.id ?? null);

  return {
    ...data,
    foods: filterDeletedFoodsFromFoods(data.foods, deletedFoodSet),
    profiles,
    activeProfileId,
    deletedDayLogEntries: [...deletedDayLogEntries],
    deletedFoods: [...deletedFoods],
    deletedProfiles: [...deletedProfiles],
  };
}
