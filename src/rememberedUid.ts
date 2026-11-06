/**
 * The account last confirmed signed in on this browser, so a launch can draw
 * that account's local copy at once instead of waiting for Firebase Auth.
 *
 * Auth only reports the stored session after checking it with Google
 * (`accounts:lookup`, plus a token refresh when the app sat closed for over
 * an hour): one or two round trips before anything could be drawn, on every
 * launch. Firestore holds its requests until Auth has answered, so nothing
 * reaches the cloud under a uid that Auth has not confirmed; if Auth answers
 * with another account, or none, the app switches to it.
 */
export const REMEMBERED_UID_KEY = "nutriapp-signed-in-uid";

export function readRememberedUid(storage: Storage = localStorage): string | null {
  try {
    const uid = storage.getItem(REMEMBERED_UID_KEY);
    return uid != null && uid.length > 0 ? uid : null;
  } catch {
    return null;
  }
}

/** Records what Auth answered: the signed-in uid, or nobody. */
export function rememberUid(uid: string | null, storage: Storage = localStorage): void {
  try {
    if (uid == null) storage.removeItem(REMEMBERED_UID_KEY);
    else if (storage.getItem(REMEMBERED_UID_KEY) !== uid) storage.setItem(REMEMBERED_UID_KEY, uid);
  } catch {
    // Storage blocked or full: the next launch just waits for Auth.
  }
}

/**
 * The account to draw: Auth's answer once it has one, and until then the
 * remembered account, if any.
 */
export function uidToShow(authLoading: boolean, authUid: string | null, remembered: string | null): string | null {
  return authLoading ? remembered : authUid;
}
