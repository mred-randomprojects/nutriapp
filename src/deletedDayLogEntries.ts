import type {
  AppData,
  DayLog,
  DeletedDayLogEntry,
  LogEntryId,
  ProfileId,
} from "./types";

export function deletedDayLogEntryKey(
  profileId: ProfileId,
  date: string,
  entryId: LogEntryId,
): string {
  return `${profileId}\u0000${date}\u0000${entryId}`;
}

export function buildDeletedDayLogEntrySet(
  deletedEntries: ReadonlyArray<DeletedDayLogEntry>,
): Set<string> {
  return new Set(
    deletedEntries.map((entry) =>
      deletedDayLogEntryKey(entry.profileId, entry.date, entry.entryId),
    ),
  );
}

export function mergeDeletedDayLogEntries(
  localDeletedEntries: ReadonlyArray<DeletedDayLogEntry>,
  cloudDeletedEntries: ReadonlyArray<DeletedDayLogEntry>,
): DeletedDayLogEntry[] {
  const byKey = new Map<string, DeletedDayLogEntry>();

  for (const deletedEntry of [
    ...localDeletedEntries,
    ...cloudDeletedEntries,
  ]) {
    const key = deletedDayLogEntryKey(
      deletedEntry.profileId,
      deletedEntry.date,
      deletedEntry.entryId,
    );
    const existing = byKey.get(key);
    if (existing == null || deletedEntry.deletedAt > existing.deletedAt) {
      byKey.set(key, deletedEntry);
    }
  }

  return [...byKey.values()];
}

export function upsertDeletedDayLogEntry(
  deletedEntries: ReadonlyArray<DeletedDayLogEntry>,
  deletedEntry: DeletedDayLogEntry,
): DeletedDayLogEntry[] {
  const targetKey = deletedDayLogEntryKey(
    deletedEntry.profileId,
    deletedEntry.date,
    deletedEntry.entryId,
  );
  const next = deletedEntries.filter(
    (entry) =>
      deletedDayLogEntryKey(entry.profileId, entry.date, entry.entryId) !==
      targetKey,
  );
  return [...next, deletedEntry];
}

export function filterDeletedDayLogEntriesFromDayLogs(
  profileId: ProfileId,
  dayLogs: ReadonlyArray<DayLog>,
  deletedDayLogEntrySet: ReadonlySet<string>,
): DayLog[] {
  return dayLogs.map((dayLog) =>
    filterDeletedDayLogEntriesFromDayLog(
      profileId,
      dayLog,
      deletedDayLogEntrySet,
    ),
  );
}

export function filterDeletedDayLogEntriesFromDayLog(
  profileId: ProfileId,
  dayLog: DayLog,
  deletedDayLogEntrySet: ReadonlySet<string>,
): DayLog {
  return {
    ...dayLog,
    entries: dayLog.entries.filter(
      (entry) =>
        !deletedDayLogEntrySet.has(
          deletedDayLogEntryKey(profileId, dayLog.date, entry.id),
        ),
    ),
  };
}

export function filterDeletedDayLogEntriesFromAppData(
  data: AppData,
  deletedDayLogEntries: ReadonlyArray<DeletedDayLogEntry>,
): AppData {
  const deletedDayLogEntrySet = buildDeletedDayLogEntrySet(
    deletedDayLogEntries,
  );

  return {
    ...data,
    deletedDayLogEntries: [...deletedDayLogEntries],
    profiles: data.profiles.map((profile) => ({
      ...profile,
      dayLogs: filterDeletedDayLogEntriesFromDayLogs(
        profile.id,
        profile.dayLogs,
        deletedDayLogEntrySet,
      ),
    })),
  };
}
