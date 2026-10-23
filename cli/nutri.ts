/**
 * Fills in the nutrition of a quick-add entry that was logged "to estimate
 * later", writing straight to the cloud document. Safe by construction:
 *   - without --write it only shows what it would change;
 *   - before writing it saves the whole document to ~/.nutriapp/backups/;
 *   - the write carries the document's update time as a precondition, so if
 *     the app saved in between, Firestore refuses it and nothing changes;
 *   - it checks, before sending and again on what Firestore stored, that the
 *     one entry is the only thing that changed.
 * The app takes the change on its next pull: the cloud wins every merge
 * except for this device's own pending edits (src/syncMerge.ts).
 *
 *   npm run nutri -- show 2026-10-22
 *   npm run nutri -- estimate 2026-10-22 <entry-id> --kcal 1300 --protein 52 --satfat 21 --fiber 6 [--note "…"] [--force] [--write]
 *
 * Auth is the gcloud login (`gcloud auth print-access-token`), which owns the
 * Firebase project.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  EstimateError,
  listDay,
  locateQuickAdd,
  onlyEntryChanged,
  profilesWithEstimate,
  type FsDocument,
} from "../src/estimateEntry.js";

const PROJECT = process.env.NUTRIAPP_PROJECT ?? "nutriapp-9ac19";
const DOC = process.env.NUTRIAPP_DOC ?? "users/w8uyqK5tE3gMScvin2yUI1VG8ec2/data/appData";
const PROFILE = process.env.NUTRIAPP_PROFILE ?? "Me";
const URL_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${DOC}`;

function token(): string {
  return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function call(url: string, init: { method?: string; body?: string } = {}): Promise<FsDocument> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token()}`, "x-goog-user-project": PROJECT, "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as FsDocument;
}

function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function amount(args: string[], name: string, required: boolean): number {
  const raw = flag(args, name);
  if (raw == null) {
    if (required) throw new EstimateError(`Missing ${name}.`);
    return 0;
  }
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new EstimateError(`${name} must be a number ≥ 0, got "${raw}".`);
  return n;
}

async function main(argv: string[]): Promise<void> {
  const [cmd, date, entryId, ...rest] = argv;
  if (cmd === "show" && date) {
    const doc = await call(URL_BASE);
    for (const e of listDay(doc, PROFILE, date)) {
      const kcal = e.type === "quick-add" ? `${e.calories ?? 0} kcal` : "";
      console.log(`${e.type.padEnd(9)} ${e.id}  ${e.name}  ${kcal}${e.budgeted ? "  (plan)" : ""}`);
    }
    return;
  }
  if (cmd !== "estimate" || !date || !entryId) {
    throw new EstimateError("Usage: show <date> | estimate <date> <entry-id> --kcal N [--protein N --satfat N --fiber N --note T --force --write]");
  }
  const nutrition = {
    calories: amount(rest, "--kcal", true),
    protein: amount(rest, "--protein", false),
    saturatedFat: amount(rest, "--satfat", false),
    fiber: amount(rest, "--fiber", false),
  };
  const note = flag(rest, "--note");
  const doc = await call(URL_BASE);
  const loc = locateQuickAdd(doc, PROFILE, date, entryId, rest.includes("--force"));
  const profiles = profilesWithEstimate(doc, loc, nutrition, note);
  const planned = onlyEntryChanged(doc, { ...doc.fields, profiles }, loc, profiles);
  if (planned != null) throw new EstimateError(`Refusing to write: ${planned}`);
  const name = listDay(doc, PROFILE, date).find((e) => e.id === entryId)?.name;
  console.log(`${date} · ${name}\n  → ${JSON.stringify(nutrition)}${note != null ? `\n  notes: ${note}` : ""}`);
  if (!rest.includes("--write")) {
    console.log("Dry run: nothing written. Add --write to save it.");
    return;
  }

  const dir = join(homedir(), ".nutriapp", "backups");
  mkdirSync(dir, { recursive: true });
  const backup = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backup, JSON.stringify(doc));
  console.log(`Backup: ${backup}`);

  const query = `updateMask.fieldPaths=profiles&currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}`;
  const stored = await call(`${URL_BASE}?${query}`, { method: "PATCH", body: JSON.stringify({ fields: { profiles } }) });
  const check = onlyEntryChanged(doc, stored.fields, loc, profiles);
  if (check != null) {
    throw new Error(`Written, but the stored document is not what was expected (${check}). Restore from ${backup} if needed.`);
  }
  console.log(`Saved and verified (update time ${stored.updateTime}). The app picks it up on its next sync.`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
