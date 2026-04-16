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
  const [notes, setNotes] = useState("");

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
  const isUnitBased = selectedFood?.nutritionPerUnit != null;

  const totalGrams =
    isUnitBased
      ? 0
      : inputMode === "grams"
        ? parsedAmount
        : parsedAmount * (selectedFood?.gramsPerUnit ?? 0);

  const factor = totalGrams / 100;

  function handleAdd() {
    if (selectedFoodId == null || parsedAmount <= 0) return;
    const trimmedNotes = notes.trim();
    const entryNotes = trimmedNotes.length > 0 ? trimmedNotes : undefined;
    if (isUnitBased) {
      addLogEntry(profileId, date, {
        foodId: selectedFoodId,
        grams: 0,
        units: parsedAmount,
        notes: entryNotes,
      });
    } else {
      if (totalGrams <= 0) return;
      addLogEntry(profileId, date, {
        foodId: selectedFoodId,
        grams: totalGrams,
        notes: entryNotes,
      });
    }
    resetAndClose();
  }

  function resetAndClose() {
    handleOpenChange(false);
  }

  function selectFood(foodId: FoodId) {
    const food = allFoods.find((f) => f.id === foodId);
    setSelectedFoodId(foodId);
    const foodIsUnitBased = food?.nutritionPerUnit != null;
    setInputMode(foodIsUnitBased || food?.gramsPerUnit != null ? "units" : "grams");
    setAmount("");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSelectedFoodId(null);
      setInputMode("grams");
      setAmount("");
      setSearch("");
      setNotes("");
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
                      {food.nutritionPerUnit != null
                        ? `${food.nutritionPerUnit.calories} kcal/unit`
                        : `${food.nutritionPer100g.calories} kcal/100g`}
                      {food.nutritionPerUnit == null &&
                        food.gramsPerUnit != null &&
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

            {isUnitBased ? (
              <p className="text-xs text-muted-foreground">
                This food can only be logged by unit count (weight unknown).
              </p>
            ) : (
              selectedFood.gramsPerUnit != null && (
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
              )
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
                step="any"
                placeholder={inputMode === "grams" ? "e.g. 120" : "e.g. 2"}
                autoFocus
              />
              {inputMode === "units" && !isUnitBased && parsedAmount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  = {totalGrams}g
                </p>
              )}
            </div>

            {((isUnitBased && parsedAmount > 0) || totalGrams > 0) && (
              <div className="rounded-lg bg-secondary/50 p-3 text-sm">
                <p className="mb-1 text-xs text-muted-foreground">
                  Preview ({isUnitBased
                    ? `${parsedAmount} unit${parsedAmount !== 1 ? "s" : ""}`
                    : `${totalGrams}g`})
                </p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {(() => {
                    const n = isUnitBased && selectedFood.nutritionPerUnit != null
                      ? selectedFood.nutritionPerUnit
                      : selectedFood.nutritionPer100g;
                    const m = isUnitBased ? parsedAmount : factor;
                    return (
                      <>
                        <div>
                          <p className="font-medium text-primary">
                            {Math.round(n.calories * m)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">kcal</p>
                        </div>
                        <div>
                          <p className="font-medium">
                            {Math.round(n.protein * m * 10) / 10}g
                          </p>
                          <p className="text-[10px] text-muted-foreground">Protein</p>
                        </div>
                        <div>
                          <p className="font-medium">
                            {Math.round(n.saturatedFat * m * 10) / 10}g
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            Sat. Fat
                          </p>
                        </div>
                        <div>
                          <p className="font-medium">
                            {Math.round(n.fiber * m * 10) / 10}g
                          </p>
                          <p className="text-[10px] text-muted-foreground">Fiber</p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="entry-notes">Notes (optional)</Label>
              <textarea
                id="entry-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. felt bloated, ate too fast…"
                className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                rows={2}
              />
            </div>

            <Button className="w-full" onClick={handleAdd}>
              Add to Log
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
