/**
 * Edits the log from the terminal, writing straight to the cloud document:
 * fills in the nutrition of a quick-add logged "to estimate later", or logs a
 * new quick-add. Without --write it only shows what it would do; with it, the
 * write goes through cli/ops.ts (backup, update-time precondition, and a check
 * that only that one entry changed). The app takes the change on its next
 * pull: day logs merge entry by entry (src/syncMerge.ts).
 *
 *   npm run nutri -- show 2026-10-22
 *   npm run nutri -- estimate 2026-10-22 <entry-id> --kcal 1300 --protein 52 --satfat 21 --fiber 6 [--note "…"] [--force] [--write]
 *   npm run nutri -- add 2026-10-22 --name "Empanada de carne" --kcal 300 [--protein 12 --satfat 5 --fiber 2 --note "…" --section Cena --planned] [--write]
 *
 * The same operations are offered to Claude as MCP tools (cli/mcp.ts).
 * Auth is the gcloud login (`gcloud auth print-access-token`).
 */
import { randomUUID } from "node:crypto";
import { profilesWithAddedEntry } from "../src/addEntry.js";
import { EstimateError, listDay } from "../src/estimateEntry.js";
import { PROFILE, readDoc } from "./firestore.js";
import { addMeal, estimateEntry, planEstimate } from "./ops.js";

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

function nutritionFlags(args: string[]) {
  return {
    calories: amount(args, "--kcal", true),
    protein: amount(args, "--protein", false),
    saturatedFat: amount(args, "--satfat", false),
    fiber: amount(args, "--fiber", false),
  };
}

const USAGE =
  "Usage: show <date> | estimate <date> <entry-id> --kcal N [--protein N --satfat N --fiber N --note T --force --write]" +
  " | add <date> --name T --kcal N [--protein N --satfat N --fiber N --note T --section S --planned --write]";

async function main(argv: string[]): Promise<void> {
  const [cmd, date, ...rest] = argv;
  if (cmd === "show" && date) {
    const doc = await readDoc();
    for (const e of listDay(doc, PROFILE, date)) {
      const kcal = e.type === "quick-add" ? `${e.calories ?? 0} kcal` : "";
      console.log(`${e.type.padEnd(9)} ${e.id}  ${e.name}  ${kcal}${e.budgeted ? "  (plan)" : ""}`);
    }
    return;
  }
  if (cmd === "estimate" && date && rest[0] != null) {
    const [entryId, ...opts] = rest;
    const input = { date, entryId, nutrition: nutritionFlags(opts), notes: flag(opts, "--note"), force: opts.includes("--force") };
    const doc = await readDoc();
    planEstimate(doc, input); // throws on anything it refuses
    const name = listDay(doc, PROFILE, date).find((e) => e.id === entryId)?.name;
    console.log(`${date} · ${name}\n  → ${JSON.stringify(input.nutrition)}${input.notes != null ? `\n  notes: ${input.notes}` : ""}`);
    if (!opts.includes("--write")) {
      console.log("Dry run: nothing written. Add --write to save it.");
      return;
    }
    const result = await estimateEntry(input);
    console.log(`Backup: ${result.backup}\nSaved and verified. The app picks it up on its next sync.`);
    return;
  }
  if (cmd === "add" && date) {
    const name = flag(rest, "--name");
    if (name == null) throw new EstimateError("Missing --name.");
    const input = {
      date,
      name,
      nutrition: nutritionFlags(rest),
      notes: flag(rest, "--note"),
      section: flag(rest, "--section"),
      planned: rest.includes("--planned"),
    };
    // Plans it on the current document first, so a dry run refuses what the write would.
    profilesWithAddedEntry(await readDoc(), PROFILE, date, { id: randomUUID(), name, nutrition: input.nutrition, notes: input.notes, budgeted: input.planned }, input.section);
    console.log(`${date}${input.section != null ? ` · ${input.section}` : ""} + ${name}\n  → ${JSON.stringify(input.nutrition)}`);
    if (!rest.includes("--write")) {
      console.log("Dry run: nothing written. Add --write to save it.");
      return;
    }
    const result = await addMeal(input);
    console.log(`Added ${result.entryId}. Backup: ${result.backup}\nSaved and verified. The app picks it up on its next sync.`);
    return;
  }
  throw new EstimateError(USAGE);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
