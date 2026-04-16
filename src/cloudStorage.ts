import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { AppData } from "./types";

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

export async function loadCloudData(uid: string): Promise<AppData | null> {
  const snap = await getDoc(userDocRef(uid));
  if (!snap.exists()) return null;
  const raw = snap.data();
  if (raw == null) return null;
  return {
    foods: raw.foods ?? [],
    profiles: raw.profiles ?? [],
    activeProfileId: raw.activeProfileId ?? null,
  };
}

export async function saveCloudData(
  uid: string,
  data: AppData,
): Promise<void> {
  const payload = stripUndefined({
    foods: data.foods,
    profiles: data.profiles,
    activeProfileId: data.activeProfileId,
  }) as Record<string, unknown>;
  await setDoc(userDocRef(uid), payload);
}
