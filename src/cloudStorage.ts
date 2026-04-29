import { doc, getDoc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import type { AppData } from "./types";
import {
  filterDeletedDayLogEntriesFromAppData,
  mergeDeletedDayLogEntries,
} from "./deletedDayLogEntries";

/**
 * Recursively strips keys whose value is `undefined` so that
 * Firestore's setDoc never sees an unsupported field value.
 */
function stripUndefined(obj: unknown): unknown {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      clean[key] = stripUndefined(value);
    }
  }
  return clean;
}

function userDocRef(uid: string) {
  return doc(db, "users", uid, "data", "appData");
}

function appDataFromRaw(raw: Record<string, unknown>): AppData {
  return {
    foods: raw.foods ?? [],
    profiles: raw.profiles ?? [],
    activeProfileId: raw.activeProfileId ?? null,
    deletedDayLogEntries: raw.deletedDayLogEntries ?? [],
  } as AppData;
}

function payloadFromAppData(data: AppData): Record<string, unknown> {
  return stripUndefined({
    foods: data.foods,
    profiles: data.profiles,
    activeProfileId: data.activeProfileId,
    deletedDayLogEntries: data.deletedDayLogEntries,
  }) as Record<string, unknown>;
}

export async function loadCloudData(uid: string): Promise<AppData | null> {
  const snap = await getDoc(userDocRef(uid));
  if (!snap.exists()) return null;
  const raw = snap.data();
  if (raw == null) return null;
  return appDataFromRaw(raw);
}

export async function saveCloudData(
  uid: string,
  data: AppData,
): Promise<void> {
  const ref = userDocRef(uid);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const cloudData = snap.exists() ? appDataFromRaw(snap.data()) : null;
    // Preserve remote tombstones so stale devices cannot resurrect deleted entries.
    const deletedDayLogEntries = mergeDeletedDayLogEntries(
      data.deletedDayLogEntries ?? [],
      cloudData?.deletedDayLogEntries ?? [],
    );
    const filteredData = filterDeletedDayLogEntriesFromAppData(
      {
        ...data,
        deletedDayLogEntries,
      },
      deletedDayLogEntries,
    );

    transaction.set(ref, payloadFromAppData(filteredData));
  });
}
