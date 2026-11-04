/**
 * NutriApp as an MCP server (stdio), so Claude can log meals during a
 * conversation: show a day, add a quick-add with Claude's estimate, or fill in
 * (or correct) the estimate of one already logged. Every write goes through
 * cli/ops.ts: backup, update-time precondition, and a check that the one
 * entry is the only thing that changed. The app picks the change up the next
 * time its window gets the focus.
 *
 * Registered in Claude Code with scripts/mcp.sh (see the README). The
 * protocol is small enough to speak by hand: newline-delimited JSON-RPC 2.0
 * on stdin/stdout; stdout carries nothing else, so logs go to stderr.
 */
import { createInterface } from "node:readline";
import type { NutritionValues } from "../src/types.js";
import type { DayView } from "../src/dayView.js";
import { EstimateError } from "../src/estimateEntry.js";
import { PROFILE } from "./firestore.js";
import { addMeal, estimateEntry, showDay, type WriteResult } from "./ops.js";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Max's food log in NutriApp (profile "${PROFILE}"). When Max says what was eaten, estimate it and log it with nutriapp_add_meal; don't ask for numbers Max wouldn't know.
- Estimate per portion as eaten, in kcal and grams (protein, saturated fat, fiber). Put the portion you assumed in the name, as the app's entries do ("Ensalada de arroz y atún (250 g)"), and the breakdown in notes.
- Days have sections (separators such as "Breakfast (07:00)", "LUNCH (12:30)", "Dinner (20:30)"): call nutriapp_show_day first to see them, and pass the one that fits as section.
- Entries marked planned are the day's plan, not food eaten; new meals Max reports are eaten (planned: false) unless Max is planning ahead.
- If Max corrects an amount, fix that entry with nutriapp_estimate_entry (replace: true) rather than adding a second one. Deleting is done in the app.
- Dates are YYYY-MM-DD in local time; omit date for today.`;

const nutritionProps = {
  calories: { type: "number", minimum: 0, description: "kcal of the whole portion" },
  protein: { type: "number", minimum: 0, description: "grams of protein" },
  saturated_fat: { type: "number", minimum: 0, description: "grams of saturated fat" },
  fiber: { type: "number", minimum: 0, description: "grams of fiber" },
};
const dateProp = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD, local time; today when omitted" };

const TOOLS = [
  {
    name: "nutriapp_show_day",
    description: "Shows one day of the log: its sections, every entry with its nutrition and id, and the totals eaten and planned against the goals.",
    inputSchema: { type: "object", properties: { date: dateProp }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "nutriapp_add_meal",
    description:
      "Logs a new quick-add entry (a one-off food with its own estimated nutrition) on a day, at the end of a section or of the day. Returns the new entry's id and the day's updated totals.",
    inputSchema: {
      type: "object",
      properties: {
        date: dateProp,
        name: { type: "string", minLength: 1, description: 'What was eaten, with the portion: "Empanadas de carne x2 (180 g)"' },
        ...nutritionProps,
        notes: { type: "string", description: "How the estimate was made: ingredients, grams assumed, sources" },
        section: { type: "string", description: 'Section label to add it under, matched ignoring case and accents, e.g. "lunch" or "Dinner"' },
        planned: { type: "boolean", description: "true for a planned (budgeted) item not eaten yet; default false" },
      },
      required: ["name", "calories", "protein", "saturated_fat", "fiber"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "nutriapp_estimate_entry",
    description:
      "Sets the nutrition of an existing quick-add entry: one logged in the app with just a name, to estimate later, or (with replace: true) one whose estimate needs correcting. Food-database entries can't be changed here.",
    inputSchema: {
      type: "object",
      properties: {
        date: dateProp,
        entry_id: { type: "string", description: "The entry's id, from nutriapp_show_day" },
        ...nutritionProps,
        notes: { type: "string", description: "Replaces the entry's notes when given" },
        replace: { type: "boolean", description: "Allow overwriting an entry that already has calories; default false" },
      },
      required: ["entry_id", "calories", "protein", "saturated_fat", "fiber"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

type Args = Record<string, unknown>;

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function optString(args: Args, key: string): string | null {
  const v = args[key];
  if (v == null) return null;
  if (typeof v !== "string") throw new EstimateError(`${key} must be a string.`);
  return v;
}

function reqString(args: Args, key: string): string {
  const v = optString(args, key);
  if (v == null || v.trim().length === 0) throw new EstimateError(`${key} is required.`);
  return v;
}

function bool(args: Args, key: string): boolean {
  const v = args[key];
  if (v == null) return false;
  if (typeof v !== "boolean") throw new EstimateError(`${key} must be true or false.`);
  return v;
}

function grams(args: Args, key: string): number {
  const v = args[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new EstimateError(`${key} must be a number ≥ 0.`);
  return v;
}

function nutrition(args: Args): NutritionValues {
  return {
    calories: grams(args, "calories"),
    protein: grams(args, "protein"),
    saturatedFat: grams(args, "saturated_fat"),
    fiber: grams(args, "fiber"),
  };
}

function dateArg(args: Args): string {
  return optString(args, "date") ?? today();
}

const fmt = (v: NutritionValues) => `${v.calories} kcal · P ${v.protein} g · SatF ${v.saturatedFat} g · Fib ${v.fiber} g`;

function renderDay(day: DayView): string {
  const lines = [`${day.date} (${day.profile})${day.signedOff != null ? ` — signed off: ${day.signedOff}` : ""}`];
  if (day.entries.length === 0 && day.sections.length === 0) lines.push("Nothing logged.");
  let section: string | null | undefined;
  const sectionsShown = new Set<string>();
  for (const e of day.entries) {
    if (e.section !== section) {
      section = e.section;
      if (section != null) {
        lines.push(`\n## ${section}`);
        sectionsShown.add(section);
      }
    }
    const tags = [e.kind === "quick-add" ? "quick-add" : "food", e.planned ? "planned" : null].filter((t) => t != null).join(", ");
    const amount = e.amount != null ? ` — ${e.amount}` : "";
    const values = e.nutrition != null ? fmt(e.nutrition) : "nutrition unknown";
    lines.push(`- ${e.name}${amount}: ${values} [${tags}] id=${e.id}${e.notes != null ? `\n  notes: ${e.notes}` : ""}`);
  }
  const empty = day.sections.filter((s) => !sectionsShown.has(s));
  if (empty.length > 0) lines.push(`\nEmpty sections: ${empty.join(", ")}`);
  lines.push(`\nEaten: ${fmt(day.eaten)}`);
  lines.push(`Planned, not eaten yet: ${fmt(day.planned)}`);
  if (day.goals != null) lines.push(`Goals: ${fmt(day.goals)}`);
  return lines.join("\n");
}

function renderWrite(verb: string, result: WriteResult): string {
  return `${verb} (entry ${result.entryId}); verified in the cloud. The app shows it the next time its window gets the focus.\nBackup of the document before the change: ${result.backup}\n\n${renderDay(result.day)}`;
}

async function callTool(name: string, args: Args): Promise<string> {
  switch (name) {
    case "nutriapp_show_day":
      return renderDay(await showDay(dateArg(args)));
    case "nutriapp_add_meal":
      return renderWrite(
        "Added",
        await addMeal({
          date: dateArg(args),
          name: reqString(args, "name"),
          nutrition: nutrition(args),
          notes: optString(args, "notes"),
          section: optString(args, "section"),
          planned: bool(args, "planned"),
        }),
      );
    case "nutriapp_estimate_entry":
      return renderWrite(
        "Estimate saved",
        await estimateEntry({
          date: dateArg(args),
          entryId: reqString(args, "entry_id"),
          nutrition: nutrition(args),
          notes: optString(args, "notes"),
          force: bool(args, "replace"),
        }),
      );
    default:
      throw new EstimateError(`Unknown tool ${name}.`);
  }
}

type Id = string | number;
interface Request {
  jsonrpc: "2.0";
  id?: Id;
  method: string;
  params?: Args;
}

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function isRecord(v: unknown): v is Args {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

async function handle(req: Request): Promise<void> {
  const reply = (result: object) => {
    if (req.id != null) send({ jsonrpc: "2.0", id: req.id, result });
  };
  const fail = (code: number, message: string) => {
    if (req.id != null) send({ jsonrpc: "2.0", id: req.id, error: { code, message } });
  };
  switch (req.method) {
    case "initialize": {
      const asked = req.params?.protocolVersion;
      const version = typeof asked === "string" && SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
      reply({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nutriapp", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
      return;
    }
    case "ping":
      reply({});
      return;
    case "tools/list":
      reply({ tools: TOOLS });
      return;
    case "tools/call": {
      const name = req.params?.name;
      const args = req.params?.arguments ?? {};
      if (typeof name !== "string" || !isRecord(args)) {
        fail(-32602, "tools/call needs a name and an arguments object.");
        return;
      }
      try {
        reply({ content: [{ type: "text", text: await callTool(name, args) }] });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).replace("pass --force", "pass replace: true");
        console.error(`[nutriapp] ${name} failed: ${message}`);
        reply({ content: [{ type: "text", text: message }], isError: true });
      }
      return;
    }
    default:
      if (req.method.startsWith("notifications/")) return;
      fail(-32601, `Method not found: ${req.method}`);
  }
}

const inFlight = new Set<Promise<void>>();
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line.trim().length === 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (!isRecord(parsed) || typeof parsed.method !== "string") return; // a response or junk: nothing to answer
  const req: Request = {
    jsonrpc: "2.0",
    id: typeof parsed.id === "string" || typeof parsed.id === "number" ? parsed.id : undefined,
    method: parsed.method,
    params: isRecord(parsed.params) ? parsed.params : undefined,
  };
  const job = handle(req)
    .catch((error: unknown) => console.error("[nutriapp]", error))
    .finally(() => inFlight.delete(job));
  inFlight.add(job);
});
// The client closing stdin ends the server, but never in the middle of a write.
rl.on("close", () => {
  void Promise.allSettled([...inFlight]).then(() => process.exit(0));
});
