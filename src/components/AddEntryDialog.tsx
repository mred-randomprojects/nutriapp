import { useState } from "react";
import type { AppDataHandle } from "../appDataType";
import type { FoodId, ProfileId } from "../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type InputMode = "grams" | "units";

interface AddEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appData: AppDataHandle;
  profileId: ProfileId;
  date: string;
}

export function AddEntryDialog({
  open,
  onOpenChange,
  appData,
  profileId,
  date,
}: AddEntryDialogProps) {
  const { allFoods, addLogEntry } = appData;
  const [selectedFoodId, setSelectedFoodId] = useState<FoodId | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("grams");
  const [amount, setAmount] = useState("");
  const [search, setSearch] = useState("");

  const filteredFoods = allFoods.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedFood =
    selectedFoodId != null
      ? allFoods.find((f) => f.id === selectedFoodId)
      : undefined;

  function parseNum(s: string): number {
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  }

  const parsedAmount = parseNum(amount);

  const totalGrams =
    inputMode === "grams"
      ? parsedAmount
      : parsedAmount * (selectedFood?.gramsPerUnit ?? 0);

  const factor = totalGrams / 100;

  function handleAdd() {
    if (selectedFoodId == null || totalGrams <= 0) return;
    addLogEntry(profileId, date, {
      foodId: selectedFoodId,
      grams: totalGrams,
    });
    resetAndClose();
  }

  function resetAndClose() {
    setSelectedFoodId(null);
    setInputMode("grams");
    setAmount("");
    setSearch("");
    onOpenChange(false);
  }

  function selectFood(foodId: FoodId) {
    const food = allFoods.find((f) => f.id === foodId);
    setSelectedFoodId(foodId);
    setInputMode(food?.gramsPerUnit != null ? "units" : "grams");
    setAmount("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Entry</DialogTitle>
          <DialogDescription>
            Search for a food, then enter grams or units.
          </DialogDescription>
        </DialogHeader>

        {selectedFood == null ? (
          <div className="space-y-3">
            <Input
              placeholder="Search foods..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {filteredFoods.map((food) => (
                <button
                  key={food.id}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent"
                  onClick={() => selectFood(food.id)}
                >
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
                      {food.nutritionPer100g.calories} kcal/100g
                      {food.gramsPerUnit != null &&
                        ` · ${food.gramsPerUnit}g/unit`}
                    </p>
                  </div>
                </button>
              ))}
              {filteredFoods.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No foods match &ldquo;{search}&rdquo;
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {selectedFood.imageUrl != null ? (
                <img
                  src={selectedFood.imageUrl}
                  alt={selectedFood.name}
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-lg">
                  🍽️
                </div>
              )}
              <div>
                <p className="font-medium">{selectedFood.name}</p>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelectedFoodId(null)}
                >
                  Change food
                </button>
              </div>
            </div>

            {/* Mode toggle — only shown if food has gramsPerUnit */}
            {selectedFood.gramsPerUnit != null && (
              <div className="flex gap-2">
                <button
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    inputMode === "grams"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input hover:bg-accent"
                  }`}
                  onClick={() => setInputMode("grams")}
                >
                  Grams
                </button>
                <button
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    inputMode === "units"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input hover:bg-accent"
                  }`}
                  onClick={() => setInputMode("units")}
                >
                  Units ({selectedFood.gramsPerUnit}g each)
                </button>
              </div>
            )}

            <div>
              <Label htmlFor="amount">
                {inputMode === "grams" ? "Grams" : "How many?"}
              </Label>
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={0.1}
                step={inputMode === "grams" ? 1 : 0.5}
                placeholder={inputMode === "grams" ? "e.g. 120" : "e.g. 2"}
                autoFocus
              />
              {inputMode === "units" && parsedAmount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  = {totalGrams}g
                </p>
              )}
            </div>

            {totalGrams > 0 && (
              <div className="rounded-lg bg-secondary/50 p-3 text-sm">
                <p className="mb-1 text-xs text-muted-foreground">
                  Preview ({totalGrams}g)
                </p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="font-medium text-primary">
                      {Math.round(
                        selectedFood.nutritionPer100g.calories * factor,
                      )}
                    </p>
                    <p className="text-[10px] text-muted-foreground">kcal</p>
                  </div>
                  <div>
                    <p className="font-medium">
                      {Math.round(
                        selectedFood.nutritionPer100g.protein * factor * 10,
                      ) / 10}
                      g
                    </p>
                    <p className="text-[10px] text-muted-foreground">Protein</p>
                  </div>
                  <div>
                    <p className="font-medium">
                      {Math.round(
                        selectedFood.nutritionPer100g.saturatedFat *
                          factor *
                          10,
                      ) / 10}
                      g
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Sat. Fat
                    </p>
                  </div>
                  <div>
                    <p className="font-medium">
                      {Math.round(
                        selectedFood.nutritionPer100g.fiber * factor * 10,
                      ) / 10}
                      g
                    </p>
                    <p className="text-[10px] text-muted-foreground">Fiber</p>
                  </div>
                </div>
              </div>
            )}

            <Button className="w-full" onClick={handleAdd}>
              Add to Log
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
