#!/usr/bin/env node

/**
 * CLI to search Open Food Facts and add foods to the pre-built dataset.
 *
 * Usage:
 *   node scripts/add-food.mjs "alfajor rasta"
 *   node scripts/add-food.mjs --barcode 7798397444202
 */

import { readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FOODS_PATH = resolve(__dirname, "../src/data/foods.json");
const OFF_SEARCH_URL = "https://search.openfoodfacts.org/search";
const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const HEADERS = {
  "User-Agent": "NutriApp CLI/1.0 (https://github.com/nutriapp)",
};

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function loadFoods() {
  try {
    return JSON.parse(readFileSync(FOODS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveFoods(foods) {
  writeFileSync(FOODS_PATH, JSON.stringify(foods, null, 2) + "\n", "utf-8");
}

function parseServingGrams(servingSize) {
  if (!servingSize) return null;
  const match = servingSize.match(/([\d.]+)\s*g/);
  return match ? parseFloat(match[1]) : null;
}

function round(n, decimals = 1) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function extractFood(product, barcode) {
  const n = product.nutriments || {};
  return {
    id: `off-${barcode}`,
    name: product.product_name || "Unknown",
    barcode,
    imageUrl: product.image_front_small_url || product.image_url || null,
    nutritionPer100g: {
      calories: round(n["energy-kcal_100g"] || 0),
      protein: round(n["proteins_100g"] || 0),
      saturatedFat: round(n["saturated-fat_100g"] || 0),
      fiber: round(n["fiber_100g"] || 0),
    },
    gramsPerUnit: parseServingGrams(product.serving_size),
  };
}

async function searchByQuery(query) {
  const params = new URLSearchParams({
    q: query,
    langs: "es",
    page_size: "10",
  });

  const res = await fetch(`${OFF_SEARCH_URL}?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`search-a-licious search failed: ${res.status}`);
  const data = await res.json();
  return (data.hits || []).map((hit) => ({
    code: hit.code,
    product_name: hit.product_name,
    nutriments: hit.nutriments || {},
  }));
}

async function fetchByBarcode(barcode) {
  const fields =
    "code,product_name,nutriments,serving_size,image_front_small_url,image_url";
  const res = await fetch(`${OFF_PRODUCT_URL}/${barcode}.json?fields=${fields}`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`Open Food Facts lookup failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== 1) return null;
  return data.product;
}

function printFood(food) {
  console.log(`  Name:          ${food.name}`);
  console.log(`  Barcode:       ${food.barcode}`);
  console.log(`  Calories:      ${food.nutritionPer100g.calories} kcal/100g`);
  console.log(`  Protein:       ${food.nutritionPer100g.protein}g/100g`);
  console.log(`  Saturated fat: ${food.nutritionPer100g.saturatedFat}g/100g`);
  console.log(`  Fiber:         ${food.nutritionPer100g.fiber}g/100g`);
  console.log(
    `  Grams/unit:    ${food.gramsPerUnit != null ? food.gramsPerUnit + "g" : "(none)"}`,
  );
  if (food.imageUrl) {
    console.log(`  Image:         ${food.imageUrl}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log('  ./add-food "alfajor rasta"');
    console.log("  ./add-food --barcode 7798397444202");
    console.log("  ./add-food --barcode 7798397444202 --yes");
    process.exit(0);
  }

  const autoConfirm = args.includes("--yes") || args.includes("-y");
  const filteredArgs = args.filter((a) => a !== "--yes" && a !== "-y");

  const foods = loadFoods();
  let food;

  if (filteredArgs[0] === "--barcode") {
    const barcode = filteredArgs[1];
    if (!barcode) {
      console.error("Error: missing barcode argument");
      process.exit(1);
    }

    if (foods.some((f) => f.barcode === barcode)) {
      console.log(`Already in dataset: barcode ${barcode}`);
      process.exit(0);
    }

    console.log(`\nLooking up barcode ${barcode}...`);
    const product = await fetchByBarcode(barcode);
    if (!product) {
      console.error("Product not found on Open Food Facts.");
      process.exit(1);
    }
    food = extractFood(product, barcode);
  } else {
    const query = filteredArgs.join(" ");
    console.log(`\nSearching Open Food Facts for "${query}"...\n`);
    const products = await searchByQuery(query);

    if (products.length === 0) {
      console.log("No results found.");
      process.exit(0);
    }

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const kcal = Math.round(p.nutriments?.["energy-kcal_100g"] || 0);
      const prot = round(p.nutriments?.["proteins_100g"] || 0);
      const already = foods.some((f) => f.barcode === p.code);
      const tag = already ? " [already added]" : "";
      console.log(
        `  ${i + 1}. ${p.product_name || "?"} (${p.code}) — ${kcal} kcal, ${prot}g prot${tag}`,
      );
    }

    const choice = await ask("\nPick a result (1-10), or 'q' to quit: ");
    if (choice.toLowerCase() === "q") {
      rl.close();
      process.exit(0);
    }

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= products.length) {
      console.error("Invalid choice.");
      rl.close();
      process.exit(1);
    }

    const chosen = products[idx];
    if (foods.some((f) => f.barcode === chosen.code)) {
      console.log(`\nAlready in dataset: ${chosen.product_name}`);
      rl.close();
      process.exit(0);
    }

    console.log(`\nFetching full product data for ${chosen.code}...`);
    const fullProduct = await fetchByBarcode(chosen.code);
    food = extractFood(fullProduct || chosen, chosen.code);
  }

  console.log("\nFood to add:");
  printFood(food);

  if (!autoConfirm) {
    const editName = await ask(`\nName [${food.name}]: `);
    if (editName.trim().length > 0) {
      food.name = editName.trim();
    }

    const editUnit = await ask(
      `Grams per unit [${food.gramsPerUnit ?? "none"}]: `,
    );
    if (editUnit.trim().length > 0) {
      const parsed = parseFloat(editUnit.trim());
      food.gramsPerUnit = isNaN(parsed) || parsed <= 0 ? null : parsed;
    }

    const confirm = await ask("\nAdd this food? (y/n): ");
    if (confirm.toLowerCase() !== "y") {
      console.log("Cancelled.");
      rl.close();
      process.exit(0);
    }
  }

  foods.push(food);
  saveFoods(foods);
  console.log(`\n✓ Added "${food.name}" to src/data/foods.json`);
  console.log(`  Dataset now has ${foods.length} food(s).`);

  rl.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  rl.close();
  process.exit(1);
});
