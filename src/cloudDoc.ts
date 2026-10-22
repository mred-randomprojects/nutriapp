import type {
  AppData,
  DeletedDayLogEntry,
  DeletedFood,
  DeletedProfile,
  Food,
  Profile,
  ProfileId,
} from "./types.js";

/**
 * The cloud copy as Firestore holds it (users/{uid}/data/appData), without
 * the Firestore SDK: how AppData becomes the document's fields and back, and
 * how big that document is.
 */

/** Firestore's limit on the size of one document. */
export const CLOUD_DOC_LIMIT_BYTES = 1_048_576;

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

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The six AppData fields; a missing or malformed one reads as empty. */
export function appDataFromRaw(raw: Record<string, unknown>): AppData {
  return {
    foods: list(raw.foods) as Food[],
    profiles: list(raw.profiles) as Profile[],
    activeProfileId:
      typeof raw.activeProfileId === "string" ? (raw.activeProfileId as ProfileId) : null,
    deletedDayLogEntries: list(raw.deletedDayLogEntries) as DeletedDayLogEntry[],
    deletedFoods: list(raw.deletedFoods) as DeletedFood[],
    deletedProfiles: list(raw.deletedProfiles) as DeletedProfile[],
  };
}

/**
 * Exactly these six fields, nothing else: firestore.rules accepts no other.
 * A new top-level field needs a matching change there first.
 */
export function payloadFromAppData(data: AppData): Record<string, unknown> {
  return stripUndefined({
    foods: data.foods,
    profiles: data.profiles,
    activeProfileId: data.activeProfileId,
    deletedDayLogEntries: data.deletedDayLogEntries,
    deletedFoods: data.deletedFoods,
    deletedProfiles: data.deletedProfiles,
  }) as Record<string, unknown>;
}

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Firestore's storage size of a value, the unit of its 1 MiB limit: a string
 * is its UTF-8 bytes + 1, a number 8, a boolean or null 1, a map the sizes of
 * its field names (+1 each) and values, an array the sizes of its values.
 * An undefined field is not stored, so it counts nothing.
 */
export function firestoreValueSize(value: unknown): number {
  if (value === undefined) return 0;
  if (value === null || typeof value === "boolean") return 1;
  if (typeof value === "number") return 8;
  if (typeof value === "string") return utf8Bytes(value) + 1;
  if (Array.isArray(value)) {
    let sum = 0;
    for (const item of value) sum += firestoreValueSize(item);
    return sum;
  }
  if (typeof value === "object") {
    let sum = 0;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      sum += utf8Bytes(key) + 1 + firestoreValueSize(item);
    }
    return sum;
  }
  return 0;
}

/**
 * The size Firestore counts for `uid`'s users/{uid}/data/appData holding
 * `data`: the document name (each path segment + 1, plus 16), its fields,
 * and 32 bytes of overhead.
 */
export function cloudDocBytes(uid: string, data: AppData): number {
  const name = ["users", uid, "data", "appData"].reduce((sum, part) => sum + utf8Bytes(part) + 1, 16);
  const fields = firestoreValueSize({
    foods: data.foods,
    profiles: data.profiles,
    activeProfileId: data.activeProfileId,
    deletedDayLogEntries: data.deletedDayLogEntries,
    deletedFoods: data.deletedFoods,
    deletedProfiles: data.deletedProfiles,
  });
  return name + fields + 32;
}
