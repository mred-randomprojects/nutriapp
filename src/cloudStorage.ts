import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { AppData } from "./types";

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
  await setDoc(userDocRef(uid), {
    foods: data.foods,
    profiles: data.profiles,
    activeProfileId: data.activeProfileId,
  });
}
