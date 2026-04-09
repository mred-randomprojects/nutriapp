import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Plus, X } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type { NutritionPer100g, Serving } from "../types";
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
    ? appData.data.foods.find((f) => f.id === foodId)
    : undefined;

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

  const [servings, setServings] = useState<Serving[]>(
    existing?.servings ?? [{ label: "100g", grams: 100 }],
  );

  const [newServingLabel, setNewServingLabel] = useState("");
  const [newServingGrams, setNewServingGrams] = useState("");

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
    const validServings =
      servings.length > 0
        ? servings
        : [{ label: "100g", grams: 100 }];

    if (existing != null) {
      appData.updateFood(existing.id, {
        name: name.trim(),
        imageUrl: imageUrl.trim().length > 0 ? imageUrl.trim() : null,
        nutritionPer100g,
        servings: validServings,
      });
    } else {
      appData.addFood({
        name: name.trim(),
        imageUrl: imageUrl.trim().length > 0 ? imageUrl.trim() : null,
        nutritionPer100g,
        servings: validServings,
      });
    }
    navigate("/foods");
  }

  function addServing() {
    const grams = parseNum(newServingGrams);
    if (newServingLabel.trim().length === 0 || grams <= 0) return;
    setServings([
      ...servings,
      { label: newServingLabel.trim(), grams },
    ]);
    setNewServingLabel("");
    setNewServingGrams("");
  }

  function removeServing(index: number) {
    setServings(servings.filter((_, i) => i !== index));
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
          {existing != null ? "Edit Food" : "Add Food"}
        </h1>
      </div>

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
              />
            </div>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Nutrition</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
                Enter nutritional values for this many grams. Will be normalized to per 100g.
              </p>
            </div>
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
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Servings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {servings.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 text-sm">
                  {s.label} ({s.grams}g)
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeServing(i)}
                >
                  <X className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="servingLabel">Label</Label>
                <Input
                  id="servingLabel"
                  value={newServingLabel}
                  onChange={(e) => setNewServingLabel(e.target.value)}
                  placeholder="e.g. 1 unit"
                />
              </div>
              <div className="w-24">
                <Label htmlFor="servingGrams">Grams</Label>
                <Input
                  id="servingGrams"
                  type="number"
                  value={newServingGrams}
                  onChange={(e) => setNewServingGrams(e.target.value)}
                  min={1}
                />
              </div>
              <Button variant="secondary" size="icon" onClick={addServing}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={handleSubmit}>
          {existing != null ? "Save Changes" : "Add Food"}
        </Button>
      </div>
    </div>
  );
}
