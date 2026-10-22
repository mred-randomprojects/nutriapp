import { doc, getDocFromServer, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import type { AppData } from "./types";
import { appDataFromRaw, payloadFromAppData } from "./cloudDoc";
import type { CloudWrite } from "./syncEngine";

function userDocRef(uid: string) {
  return doc(db, "users", uid, "data", "appData");
}

/**
 * The server's copy, never the SDK's cache: offline this fails instead of
 * answering with an older copy that a pull would take for the latest one.
 */
export async function loadCloudData(uid: string): Promise<AppData | null> {
  const snap = await getDocFromServer(userDocRef(uid));
  if (!snap.exists()) return null;
  const raw = snap.data();
  if (raw == null) return null;
  return appDataFromRaw(raw);
}

/**
 * Reads the user's document in a transaction and writes whatever `build`
 * makes of it (nothing when it returns null). Firestore re-runs `build` on
 * every retry with the copy that retry read, so the write always lands on
 * top of the latest copy instead of replacing it with an older snapshot.
 */
export async function writeCloudData(
  uid: string,
  build: (cloud: AppData | null) => AppData | null,
): Promise<CloudWrite> {
  const ref = userDocRef(uid);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const cloud = snap.exists() ? appDataFromRaw(snap.data()) : null;
    const written = build(cloud);
    if (written != null) transaction.set(ref, payloadFromAppData(written));
    return { cloud, written };
  });
}
