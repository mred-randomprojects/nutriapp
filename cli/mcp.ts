/**
 * NutriApp as an MCP server (stdio), so Claude can log meals during a
 * conversation: show a day, add a quick-add with Claude's estimate, or fill in
 * (or correct) the estimate of one already logged. Every write goes through
 * cli/ops.ts: backup, update-time precondition, and a check that the one
 * entry is the only thing that changed. The app picks the change up the next
 * time its window gets the focus.
 *
 * It also searches Foods, adds a food to it (simple, per unit or combo, with
 * an image) or changes one, logs a food by grams or units,
 * and removes an entry the way the app's delete does (a tombstone).
 *
 * Registered in Claude Code with scripts/mcp.sh (see the README). The
 * protocol is small enough to speak by hand: newline-delimited JSON-RPC 2.0
 * on stdin/stdout; stdout carries nothing else, so logs go to stderr.
 */
import { createInterface } from "node:readline";
import type { NutritionValues } from "../src/types.js";
import type { DayView } from "../src/dayView.js";
import { EstimateError } from "../src/estimateEntry.js";
import { cleanImageUrl, type FoodNutrition, type FoodPatch } from "../src/foodsEdit.js";
import { PROFILE } from "./firestore.js";
import type { Food } from "../src/types.js";
import { addFood, addMeal, estimateEntry, logFood, removeEntry, searchFoods, showDay, updateFood, type WriteResult } from "./ops.js";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Max's food log in NutriApp (profile "${PROFILE}"). When Max says what was eaten, log it; don't ask for numbers Max wouldn't know.
- Prefer Max's own Foods. For each component of a meal, search with nutriapp_find_foods and log the match with nutriapp_log_food, by grams (or units). Mind how a food is weighed: names say "pesado crudo" / "pesado cocido"; pick the one that matches how Max weighed or estimated it.
- A component Max will eat again that isn't in Foods: add it with nutriapp_add_food (per 100 g, from a reliable source such as USDA or the product's label, cited back to Max), then log it. A one-off dish with no reusable parts: a quick-add with nutriapp_add_meal, the portion in its name ("Ensalada de arroz y atún (250 g)") and the breakdown in notes.
- Days have sections (separators such as "Breakfast (07:00)", "LUNCH (12:30)", "Dinner (20:30)"): call nutriapp_show_day first to see them, and pass the one that fits as section.
- Entries marked planned are the day's plan, not food eaten; new meals Max reports are eaten (planned: false) unless Max is planning ahead.
- If Max corrects a quick-add, fix it with nutriapp_estimate_entry (replace: true). To redo an entry another way (a quick-add that should have been a food, a wrong food), log the new one and remove the old one with nutriapp_remove_entry; the app can undo a removal.
- Dates are YYYY-MM-DD in local time; omit date for today (after midnight, a meal Max had last night belongs to yesterday).
- Foods are added the way Max's Food form adds them: give each new food an image_url (the product's photo for a branded product, a stable photo such as Wikimedia Commons for a generic food) and check that the URL loads. A food with no known weight per unit (a supplement scoop, a restaurant dish) is per: "unit". A mix Max repeats in the same proportions (yogurt with nuts and seeds) is a combo: pass ingredients instead of nutrition, then log the combo by units or grams. nutriapp_update_food changes a food (name, image, nutrition, unit size, ingredients) and every entry logged with it follows.
- When these tools can't do what Max asks, say so and extend this server (cli/mcp.ts in the nutriapp repo) instead of working around it.`;

const nutritionProps = {
  calories: { type: "number", minimum: 0, description: "kcal of the whole portion" },
  protein: { type: "number", minimum: 0, description: "grams of protein" },
  saturated_fat: { type: "number", minimum: 0, description: "grams of saturated fat" },
  fiber: { type: "number", minimum: 0, description: "grams of fiber" },
};
const dateProp = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD, local time; today when omitted" };

const foodNameProp = {
  type: "string",
  minLength: 1,
  description: "Name in the style of Max's foods, saying how it is weighed when that matters: Espinaca congelada (pesada congelada)",
};
const foodShapeProps = {
  image_url: { type: "string", description: "http(s) URL of a photo of the food, shown in the app's Foods list" },
  per: {
    type: "string",
    enum: ["100g", "unit"],
    description: '"100g" (default): calories etc. are per 100 g. "unit": they are per unit and the weight is unknown, so it is logged by units only.',
  },
  calories: { type: "number", minimum: 0, description: "kcal per 100 g (or per unit)" },
  protein: { type: "number", minimum: 0, description: "grams of protein per 100 g (or per unit)" },
  saturated_fat: { type: "number", minimum: 0, description: "grams of saturated fat per 100 g (or per unit)" },
  fiber: { type: "number", minimum: 0, description: "grams of fiber per 100 g (or per unit)" },
  grams_per_unit: {
    type: "number",
    minimum: 0,
    description: "For a per-100 g food: weight of one unit, when it comes in units (a yogurt cup, a bar), so it can also be logged by units. 0 removes it.",
  },
  ingredients: {
    type: "array",
    minItems: 1,
    description: "Makes it a combo: its nutrition is computed from these foods (not unit-only ones) at these grams, and one unit is the whole mix. Replaces the nutrition fields.",
    items: {
      type: "object",
      properties: {
        food_id: { type: "string", description: "An ingredient's id, from nutriapp_find_foods" },
        grams: { type: "number", exclusiveMinimum: 0, description: "Grams of it in one serving of the combo" },
      },
      required: ["food_id", "grams"],
      additionalProperties: false,
    },
  },
};

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
  {
    name: "nutriapp_find_foods",
    description:
      "Searches Max's Foods (the food database) by name, ignoring case and accents; every word must match. Shows each food's id, nutrition per 100 g, unit size and combo ingredients.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: 'Words of the name, e.g. "arroz" or "yogur serenisima"; empty lists every food' } },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "nutriapp_add_food",
    description:
      "Adds a food to Foods, as the app's Food form does: a simple food with its nutrition per 100 g (or per unit), or a combo of other foods by grams, with an optional image. Refuses a name Foods already has. Returns the new food's id.",
    inputSchema: {
      type: "object",
      properties: { name: foodNameProp, ...foodShapeProps },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "nutriapp_update_food",
    description:
      "Changes a food in Foods as the app's edit does: only the fields given change, and every entry logged with it follows. Nutrition values go all four together (per 100 g, or per unit with per: \"unit\"); ingredients replace a combo's mix or turn a food into a combo.",
    inputSchema: {
      type: "object",
      properties: {
        food_id: { type: "string", description: "The food's id, from nutriapp_find_foods" },
        name: foodNameProp,
        ...foodShapeProps,
        image_url: { type: "string", description: "http(s) URL of a photo of the food; an empty string removes the image" },
      },
      required: ["food_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "nutriapp_log_food",
    description:
      "Logs a food from Foods on a day, by grams or by units, at the end of a section or of the day. Returns the new entry's id and the day's updated totals.",
    inputSchema: {
      type: "object",
      properties: {
        date: dateProp,
        food_id: { type: "string", description: "The food's id, from nutriapp_find_foods" },
        grams: { type: "number", exclusiveMinimum: 0, description: "Grams eaten, weighed the way the food's name says" },
        units: { type: "number", exclusiveMinimum: 0, description: "Units eaten, for a food with a unit size or a unit-only food (instead of grams)" },
        notes: { type: "string", description: "Optional note on the entry" },
        section: { type: "string", description: 'Section label to add it under, matched ignoring case and accents, e.g. "lunch" or "Dinner"' },
        planned: { type: "boolean", description: "true for a planned (budgeted) item not eaten yet; default false" },
      },
      required: ["food_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: "nutriapp_remove_entry",
    description:
      "Removes an entry from a day the way the app's delete does (a deletion the app can undo). Use it to replace an entry logged the wrong way, never on Max's own entries without Max asking.",
    inputSchema: {
      type: "object",
      properties: { date: dateProp, entry_id: { type: "string", description: "The entry's id, from nutriapp_show_day" } },
      required: ["entry_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
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

function optAmount(args: Args, key: string): number | null {
  return args[key] == null ? null : grams(args, key);
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

const NUTRITION_KEYS = ["calories", "protein", "saturated_fat", "fiber"];

function ingredientsArg(args: Args): { foodId: string; grams: number }[] | null {
  const v = args.ingredients;
  if (v == null) return null;
  if (!Array.isArray(v)) throw new EstimateError("ingredients must be a list.");
  return v.map((item: unknown) => {
    if (!isRecord(item)) throw new EstimateError("Each ingredient needs a food_id and grams.");
    return { foodId: reqString(item, "food_id"), grams: grams(item, "grams") };
  });
}

/**
 * The nutrition the arguments describe, or null when they don't touch it.
 * `existing` is the food being updated (null when adding one): with it,
 * grams_per_unit alone keeps its per-100 g values.
 */
function foodNutritionArg(args: Args, existing: Food | null): FoodNutrition | null {
  const ingredients = ingredientsArg(args);
  const hasValues = NUTRITION_KEYS.some((k) => args[k] != null);
  const per = optString(args, "per");
  if (per != null && per !== "100g" && per !== "unit") throw new EstimateError('per must be "100g" or "unit".');
  const unitSize = optAmount(args, "grams_per_unit");
  if (ingredients != null) {
    if (hasValues || per != null || unitSize != null) {
      throw new EstimateError("A combo's nutrition and unit size come from its ingredients: pass ingredients alone.");
    }
    return { kind: "combo", ingredients };
  }
  if (per === "unit") {
    if (unitSize != null) throw new EstimateError("A per-unit food has no known weight: leave grams_per_unit out.");
    if (!hasValues) throw new EstimateError("Pass calories, protein, saturated_fat and fiber per unit.");
    return { kind: "perUnit", perUnit: nutrition(args) };
  }
  const gramsPerUnit = unitSize === 0 ? null : unitSize;
  if (hasValues) {
    const keep = existing != null && existing.ingredients == null && existing.nutritionPerUnit == null ? existing.gramsPerUnit : null;
    return { kind: "per100g", per100g: nutrition(args), gramsPerUnit: unitSize == null ? keep : gramsPerUnit };
  }
  if (unitSize != null) {
    if (existing == null || existing.ingredients != null || existing.nutritionPerUnit != null) {
      throw new EstimateError("grams_per_unit alone only changes a food with nutrition per 100 g.");
    }
    return { kind: "per100g", per100g: existing.nutritionPer100g, gramsPerUnit };
  }
  if (per != null) throw new EstimateError("Pass calories, protein, saturated_fat and fiber with per.");
  return null;
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

function renderFood(food: Food, byId: Map<string, Food>): string {
  const lines = [`- ${food.name} id=${food.id}`];
  if (food.ingredients != null) {
    const parts = food.ingredients.map((i) => `${byId.get(i.foodId)?.name ?? i.foodId} ${i.grams} g`).join(" + ");
    lines.push(`  combo: ${parts}`);
    lines.push(`  per 100 g: ${fmt(food.nutritionPer100g)}`);
  } else if (food.nutritionPerUnit != null) {
    lines.push(`  per unit (units only): ${fmt(food.nutritionPerUnit)}`);
  } else {
    lines.push(`  per 100 g: ${fmt(food.nutritionPer100g)}`);
  }
  if (food.gramsPerUnit != null) lines.push(`  1 unit = ${food.gramsPerUnit} g`);
  lines.push(`  image: ${food.imageUrl ?? "none"}`);
  return lines.join("\n");
}

async function renderFoods(query: string): Promise<string> {
  const foods = await searchFoods(query);
  const all = query.trim().length === 0 ? foods : await searchFoods("");
  const byId = new Map(all.map((f) => [f.id as string, f]));
  if (foods.length === 0) return `No food in Foods matches "${query}".`;
  return foods.map((f) => renderFood(f, byId)).join("\n");
}

async function renderFoodById(foodId: string): Promise<string> {
  const all = await searchFoods("");
  const food = all.find((f) => f.id === foodId);
  if (food == null) return `Food ${foodId} not found after the write.`;
  return renderFood(food, new Map(all.map((f) => [f.id as string, f])));
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
    case "nutriapp_find_foods":
      return renderFoods(optString(args, "query") ?? "");
    case "nutriapp_add_food": {
      const foodNutrition = foodNutritionArg(args, null);
      if (foodNutrition == null) throw new EstimateError("Pass the nutrition (calories, protein, saturated_fat, fiber) or ingredients.");
      const result = await addFood(
        { name: reqString(args, "name"), imageUrl: cleanImageUrl(optString(args, "image_url")), nutrition: foodNutrition },
        dateArg(args),
      );
      return `Added to Foods with id ${result.entryId}; verified in the cloud. Log it with nutriapp_log_food.\nBackup of the document before the change: ${result.backup}\n\n${await renderFoodById(result.entryId)}`;
    }
    case "nutriapp_update_food": {
      const foodId = reqString(args, "food_id");
      const existing = (await searchFoods("")).find((f) => f.id === foodId) ?? null;
      if (existing == null) throw new EstimateError(`No food with id ${foodId} in Foods.`);
      const patch: FoodPatch = {};
      const name = optString(args, "name");
      if (name != null) patch.name = name;
      const imageUrl = optString(args, "image_url");
      if (imageUrl != null) patch.imageUrl = cleanImageUrl(imageUrl);
      const foodNutrition = foodNutritionArg(args, existing);
      if (foodNutrition != null) patch.nutrition = foodNutrition;
      const result = await updateFood(foodId, patch, dateArg(args));
      return `Updated in Foods; verified in the cloud. The app shows it the next time its window gets the focus.\nBackup of the document before the change: ${result.backup}\n\n${await renderFoodById(foodId)}`;
    }
    case "nutriapp_log_food":
      return renderWrite(
        "Logged",
        await logFood({
          date: dateArg(args),
          foodId: reqString(args, "food_id"),
          grams: optAmount(args, "grams"),
          units: optAmount(args, "units"),
          notes: optString(args, "notes"),
          section: optString(args, "section"),
          planned: bool(args, "planned"),
        }),
      );
    case "nutriapp_remove_entry":
      return renderWrite("Removed", await removeEntry(dateArg(args), reqString(args, "entry_id")));
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
