import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type { FoodId, NutritionPer100g } from "../types";
import { isBuiltinFood } from "../data/builtinFoods";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface FoodFormProps {
  appData: AppDataHandle;
}

export function FoodForm({ appData }: FoodFormProps) {
  const navigate = useNavigate();
  const { foodId } = useParams<{ foodId: string }>();
  const existing = foodId != null
    ? appData.allFoods.find((f) => f.id === foodId)
    : undefined;
  const readonly = existing != null && isBuiltinFood(existing.id as FoodId);

  const [name, setName] = useState(existing?.name ?? "");
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl ?? "");

  const [refGrams, setRefGrams] = useState("100");
  const [calories, setCalories] = useState(
    existing != null ? String(existing.nutritionPer100g.calories) : "",
  );
  const [protein, setProtein] = useState(
    existing != null ? String(existing.nutritionPer100g.protein) : "",
  );
  const [saturatedFat, setSaturatedFat] = useState(
    existing != null ? String(existing.nutritionPer100g.saturatedFat) : "",
  );
  const [fiber, setFiber] = useState(
    existing != null ? String(existing.nutritionPer100g.fiber) : "",
  );

  const [gramsPerUnit, setGramsPerUnit] = useState(
    existing?.gramsPerUnit != null ? String(existing.gramsPerUnit) : "",
  );

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

  function handleSubmit() {
    if (name.trim().length === 0) return;

    const nutritionPer100g = normalizeToHundredGrams();
    const parsedGramsPerUnit = parseNum(gramsPerUnit);

    if (existing != null) {
      appData.updateFood(existing.id, {
        name: name.trim(),
        imageUrl: imageUrl.trim().length > 0 ? imageUrl.trim() : null,
        nutritionPer100g,
        gramsPerUnit: parsedGramsPerUnit > 0 ? parsedGramsPerUnit : null,
      });
    } else {
      appData.addFood({
        name: name.trim(),
        imageUrl: imageUrl.trim().length > 0 ? imageUrl.trim() : null,
        nutritionPer100g,
        gramsPerUnit: parsedGramsPerUnit > 0 ? parsedGramsPerUnit : null,
      });
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

        <Card>
          <CardHeader>
            <CardTitle>Nutrition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!readonly && (
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

        {readonly ? (
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
          <>
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

            <Button className="w-full" size="lg" onClick={handleSubmit}>
              {existing != null ? "Save Changes" : "Add Food"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
