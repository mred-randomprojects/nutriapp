import { useState, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type { ComboIngredient, Food, FoodId, NutritionPer100g, NutritionValues } from "../types";
import { isBuiltinFood } from "../data/builtinFoods";
import {
  computeComboNutritionPer100g,
  comboServingNutrition,
  comboTotalGrams,
} from "../nutrition";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface FoodFormProps {
  appData: AppDataHandle;
}

interface IngredientRowProps {
  ingredient: ComboIngredient;
  food: Food;
  onUpdateGrams: (grams: number) => void;
  onRemove: () => void;
  isReadonly: boolean;
}

function IngredientRow({
  ingredient,
  food,
  onUpdateGrams,
  onRemove,
  isReadonly,
}: IngredientRowProps) {
  const [gramsStr, setGramsStr] = useState(String(ingredient.grams));

  return (
    <div className="flex items-center gap-2 border-b py-2 last:border-0">
      {food.imageUrl != null ? (
        <img
          src={food.imageUrl}
          alt={food.name}
          className="h-8 w-8 rounded object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded bg-secondary text-xs">
          🍽️
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{food.name}</p>
        <p className="text-xs text-muted-foreground">
          {Math.round(
            (food.nutritionPer100g.calories * ingredient.grams) / 100,
          )}{" "}
          kcal
        </p>
      </div>
      {!isReadonly ? (
        <>
          <Input
            type="number"
            value={gramsStr}
            onChange={(e) => {
              setGramsStr(e.target.value);
              const val = parseFloat(e.target.value);
              if (!Number.isNaN(val) && val > 0) {
                onUpdateGrams(val);
              }
            }}
            onBlur={() => {
              const val = parseFloat(gramsStr);
              if (Number.isNaN(val) || val <= 0) {
                setGramsStr(String(ingredient.grams));
              }
            }}
            className="h-8 w-20 text-sm"
            min={1}
            step="any"
          />
          <span className="shrink-0 text-xs text-muted-foreground">g</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </>
      ) : (
        <span className="shrink-0 text-sm text-muted-foreground">
          {ingredient.grams}g
        </span>
      )}
    </div>
  );
}

export function FoodForm({ appData }: FoodFormProps) {
  const navigate = useNavigate();
  const { foodId } = useParams<{ foodId: string }>();
  const existing =
    foodId != null
      ? appData.allFoods.find((f) => f.id === foodId)
      : undefined;
  const readonly = existing != null && isBuiltinFood(existing.id as FoodId);

  const [name, setName] = useState(existing?.name ?? "");
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl ?? "");

  type ReferenceType = "grams" | "unit";
  const existingIsUnitBased = existing?.nutritionPerUnit != null;
  const [referenceType, setReferenceType] = useState<ReferenceType>(
    existingIsUnitBased ? "unit" : "grams",
  );

  const [refGrams, setRefGrams] = useState("100");
  const nutritionSource =
    existingIsUnitBased ? existing.nutritionPerUnit : existing?.nutritionPer100g;
  const [calories, setCalories] = useState(
    nutritionSource != null ? String(nutritionSource.calories) : "",
  );
  const [protein, setProtein] = useState(
    nutritionSource != null ? String(nutritionSource.protein) : "",
  );
  const [saturatedFat, setSaturatedFat] = useState(
    nutritionSource != null ? String(nutritionSource.saturatedFat) : "",
  );
  const [fiber, setFiber] = useState(
    nutritionSource != null ? String(nutritionSource.fiber) : "",
  );

  const [gramsPerUnit, setGramsPerUnit] = useState(
    existing?.gramsPerUnit != null ? String(existing.gramsPerUnit) : "",
  );

  const [isCombo, setIsCombo] = useState(
    existing?.ingredients != null && existing.ingredients.length > 0,
  );
  const [ingredients, setIngredients] = useState<
    Array<{ foodId: FoodId; grams: number }>
  >(() =>
    existing?.ingredients != null
      ? existing.ingredients.map((ing) => ({ ...ing }))
      : [],
  );
  const [showIngredientPicker, setShowIngredientPicker] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");

  function parseNum(s: string): number {
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  }

  function normalizeToHundredGrams(): NutritionPer100g {
    const ref = parseNum(refGrams);
    if (ref <= 0) {
      return { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 };
    }
    const factor = 100 / ref;
    return {
      calories: Math.round(parseNum(calories) * factor * 100) / 100,
      protein: Math.round(parseNum(protein) * factor * 100) / 100,
      saturatedFat: Math.round(parseNum(saturatedFat) * factor * 100) / 100,
      fiber: Math.round(parseNum(fiber) * factor * 100) / 100,
    };
  }

  function buildNutritionPerUnit(): NutritionValues {
    return {
      calories: Math.round(parseNum(calories) * 100) / 100,
      protein: Math.round(parseNum(protein) * 100) / 100,
      saturatedFat: Math.round(parseNum(saturatedFat) * 100) / 100,
      fiber: Math.round(parseNum(fiber) * 100) / 100,
    };
  }

  const forbiddenIngredientIds = useMemo(() => {
    const forbidden = new Set<string>();
    for (const ing of ingredients) {
      forbidden.add(ing.foodId);
    }
    if (existing != null) {
      forbidden.add(existing.id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const food of appData.allFoods) {
          if (forbidden.has(food.id)) continue;
          if (food.ingredients == null) continue;
          if (food.ingredients.some((ing) => forbidden.has(ing.foodId))) {
            forbidden.add(food.id);
            changed = true;
          }
        }
      }
    }
    return forbidden;
  }, [ingredients, existing, appData.allFoods]);

  const availableFoods = useMemo(() => {
    if (!showIngredientPicker) return [];
    return appData.allFoods.filter((f) => {
      if (forbiddenIngredientIds.has(f.id)) return false;
      if (f.nutritionPerUnit != null) return false;
      if (ingredientSearch.length === 0) return true;
      return f.name.toLowerCase().includes(ingredientSearch.toLowerCase());
    });
  }, [
    showIngredientPicker,
    appData.allFoods,
    forbiddenIngredientIds,
    ingredientSearch,
  ]);

  const servingNutrition = useMemo(
    () =>
      isCombo && ingredients.length > 0
        ? comboServingNutrition(ingredients, appData.foodsMap)
        : null,
    [isCombo, ingredients, appData.foodsMap],
  );

  const comboTotalGramsValue = useMemo(
    () => comboTotalGrams(ingredients),
    [ingredients],
  );

  function handleAddIngredient(food: Food) {
    const defaultGrams = food.gramsPerUnit ?? 100;
    setIngredients((prev) => [
      ...prev,
      { foodId: food.id, grams: defaultGrams },
    ]);
    setShowIngredientPicker(false);
    setIngredientSearch("");
  }

  function handleSubmit() {
    if (name.trim().length === 0) return;

    const base = {
      name: name.trim(),
      imageUrl: imageUrl.trim().length > 0 ? imageUrl.trim() : null,
    };

    if (isCombo) {
      if (ingredients.length === 0) return;
      const nutritionPer100g = computeComboNutritionPer100g(
        ingredients,
        appData.foodsMap,
      );
      const totalGrams = comboTotalGrams(ingredients);
      const payload = {
        ...base,
        nutritionPer100g,
        nutritionPerUnit: null,
        gramsPerUnit: totalGrams > 0 ? totalGrams : null,
        ingredients: [...ingredients],
      };
      if (existing != null) {
        appData.updateFood(existing.id, payload);
      } else {
        appData.addFood(payload);
      }
    } else if (referenceType === "unit") {
      const payload = {
        ...base,
        nutritionPer100g: { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 },
        nutritionPerUnit: buildNutritionPerUnit(),
        gramsPerUnit: null,
        ingredients: null,
      };
      if (existing != null) {
        appData.updateFood(existing.id, payload);
      } else {
        appData.addFood(payload);
      }
    } else {
      const nutritionPer100g = normalizeToHundredGrams();
      const parsedGramsPerUnit = parseNum(gramsPerUnit);
      const payload = {
        ...base,
        nutritionPer100g,
        nutritionPerUnit: null,
        gramsPerUnit: parsedGramsPerUnit > 0 ? parsedGramsPerUnit : null,
        ingredients: null,
      };
      if (existing != null) {
        appData.updateFood(existing.id, payload);
      } else {
        appData.addFood(payload);
      }
    }
    navigate("/foods");
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/foods")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-bold">
          {readonly
            ? existing.name
            : existing != null
              ? "Edit Food"
              : "Add Food"}
        </h1>
      </div>

      {existing?.imageUrl != null && (
        <img
          src={existing.imageUrl}
          alt={existing.name}
          className="mx-auto h-48 w-48 rounded-xl object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Basic Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Chicken Breast"
                readOnly={readonly}
              />
            </div>
            {!readonly && (
              <div>
                <Label htmlFor="imageUrl">Image URL (optional)</Label>
                <Input
                  id="imageUrl"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                />
                {imageUrl.trim().length > 0 && (
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="mt-2 h-20 w-20 rounded-lg object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {!readonly && (
          <div className="flex gap-2">
            <button
              className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                !isCombo
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input hover:bg-accent"
              }`}
              onClick={() => setIsCombo(false)}
            >
              Simple Food
            </button>
            <button
              className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                isCombo
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input hover:bg-accent"
              }`}
              onClick={() => setIsCombo(true)}
            >
              Combo Food
            </button>
          </div>
        )}

        {isCombo ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Ingredients</CardTitle>
              </CardHeader>
              <CardContent>
                {ingredients.length === 0 && !showIngredientPicker && (
                  <p className="py-2 text-sm text-muted-foreground">
                    No ingredients yet. Add foods that make up this combo.
                  </p>
                )}

                <div>
                  {ingredients.map((ing) => {
                    const food = appData.foodsMap.get(ing.foodId);
                    if (food == null) return null;
                    return (
                      <IngredientRow
                        key={ing.foodId}
                        ingredient={ing}
                        food={food}
                        onUpdateGrams={(grams) =>
                          setIngredients((prev) =>
                            prev.map((i) =>
                              i.foodId === ing.foodId ? { ...i, grams } : i,
                            ),
                          )
                        }
                        onRemove={() =>
                          setIngredients((prev) =>
                            prev.filter((i) => i.foodId !== ing.foodId),
                          )
                        }
                        isReadonly={readonly}
                      />
                    );
                  })}
                </div>

                {!readonly &&
                  (showIngredientPicker ? (
                    <div className="mt-2 space-y-2 rounded-lg border p-2">
                      <Input
                        placeholder="Search foods to add..."
                        value={ingredientSearch}
                        onChange={(e) => setIngredientSearch(e.target.value)}
                        autoFocus
                      />
                      <div className="max-h-40 space-y-1 overflow-y-auto">
                        {availableFoods.map((food) => (
                          <button
                            key={food.id}
                            className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm transition-colors hover:bg-accent"
                            onClick={() => handleAddIngredient(food)}
                          >
                            {food.imageUrl != null ? (
                              <img
                                src={food.imageUrl}
                                alt={food.name}
                                className="h-6 w-6 rounded object-cover"
                              />
                            ) : (
                              <div className="flex h-6 w-6 items-center justify-center rounded bg-secondary text-xs">
                                🍽️
                              </div>
                            )}
                            <span className="truncate">{food.name}</span>
                            {food.gramsPerUnit != null && (
                              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                {food.gramsPerUnit}g/unit
                              </span>
                            )}
                          </button>
                        ))}
                        {availableFoods.length === 0 && (
                          <p className="py-2 text-center text-xs text-muted-foreground">
                            No matching foods found. Unit-based foods cannot be
                            used as combo ingredients yet.
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setShowIngredientPicker(false);
                          setIngredientSearch("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => setShowIngredientPicker(true)}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Add Ingredient
                    </Button>
                  ))}
              </CardContent>
            </Card>

            {ingredients.length > 0 && servingNutrition != null && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Nutrition (1 serving = {comboTotalGramsValue}g)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <p className="font-medium text-primary">
                        {Math.round(servingNutrition.calories)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">kcal</p>
                    </div>
                    <div>
                      <p className="font-medium">
                        {servingNutrition.protein}g
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Protein
                      </p>
                    </div>
                    <div>
                      <p className="font-medium">
                        {servingNutrition.saturatedFat}g
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Sat. Fat
                      </p>
                    </div>
                    <div>
                      <p className="font-medium">{servingNutrition.fiber}g</p>
                      <p className="text-[10px] text-muted-foreground">
                        Fiber
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Nutrition</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!readonly && (
                  <>
                    <div className="flex gap-2">
                      <button
                        className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          referenceType === "grams"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input hover:bg-accent"
                        }`}
                        onClick={() => setReferenceType("grams")}
                      >
                        Per grams
                      </button>
                      <button
                        className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          referenceType === "unit"
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-input hover:bg-accent"
                        }`}
                        onClick={() => setReferenceType("unit")}
                      >
                        Per unit
                      </button>
                    </div>
                    {referenceType === "grams" ? (
                      <div>
                        <Label htmlFor="refGrams">
                          Reference amount (grams)
                        </Label>
                        <Input
                          id="refGrams"
                          type="number"
                          value={refGrams}
                          onChange={(e) => setRefGrams(e.target.value)}
                          min={1}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Enter nutritional values for this many grams. Will be
                          normalized to per 100g internally.
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Enter nutritional values for 1 unit. Weight is unknown —
                        this food can only be logged by unit count.
                      </p>
                    )}
                  </>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="calories">Calories (kcal)</Label>
                    <Input
                      id="calories"
                      type="number"
                      value={calories}
                      onChange={(e) => setCalories(e.target.value)}
                      min={0}
                      step={0.1}
                      readOnly={readonly}
                    />
                  </div>
                  <div>
                    <Label htmlFor="protein">Protein (g)</Label>
                    <Input
                      id="protein"
                      type="number"
                      value={protein}
                      onChange={(e) => setProtein(e.target.value)}
                      min={0}
                      step={0.1}
                      readOnly={readonly}
                    />
                  </div>
                  <div>
                    <Label htmlFor="satFat">Saturated Fat (g)</Label>
                    <Input
                      id="satFat"
                      type="number"
                      value={saturatedFat}
                      onChange={(e) => setSaturatedFat(e.target.value)}
                      min={0}
                      step={0.1}
                      readOnly={readonly}
                    />
                  </div>
                  <div>
                    <Label htmlFor="fiber">Fiber (g)</Label>
                    <Input
                      id="fiber"
                      type="number"
                      value={fiber}
                      onChange={(e) => setFiber(e.target.value)}
                      min={0}
                      step={0.1}
                      readOnly={readonly}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {referenceType === "grams" && (
              readonly ? (
                existing.gramsPerUnit != null && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Unit Size</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {existing.gramsPerUnit}g per unit
                      </p>
                    </CardContent>
                  </Card>
                )
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Unit Size (optional)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label htmlFor="gramsPerUnit">Grams per unit</Label>
                      <Input
                        id="gramsPerUnit"
                        type="number"
                        value={gramsPerUnit}
                        onChange={(e) => setGramsPerUnit(e.target.value)}
                        min={1}
                        placeholder="e.g. 40"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        If this food is consumed by unit (e.g. 1 alfajor = 40g),
                        enter the weight of one unit. Leave empty for gram-only
                        foods like chicken breast.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )
            )}
          </>
        )}

        {!readonly && (
          <Button
            className="w-full"
            size="lg"
            onClick={handleSubmit}
            disabled={isCombo && ingredients.length === 0}
          >
            {existing != null ? "Save Changes" : "Add Food"}
          </Button>
        )}
      </div>
    </div>
  );
}
