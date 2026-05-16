import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarCheck, Utensils } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type { FoodId, NutritionValues, ProfileId } from "../types";
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
import { normalizeForSearch } from "../search";
import { DiscardChangesDialog } from "./DiscardChangesDialog";
import { useUnsavedChanges } from "../unsavedChanges";

type InputMode = "grams" | "units";
type AddMode = "search" | "quick-add" | "section";

const SEPARATOR_PRESETS = [
  "Breakfast",
  "Lunch",
  "Merienda",
  "Dinner",
  "Snack",
  "Dessert",
];

const ADD_MODE_OPTIONS: Array<{
  mode: AddMode;
  label: string;
  shortcut: string;
}> = [
  { mode: "search", label: "Foods", shortcut: "1" },
  { mode: "quick-add", label: "Quick Add", shortcut: "2" },
  { mode: "section", label: "Section", shortcut: "3" },
];

const ADD_MODE_SHORTCUTS: Partial<Record<string, AddMode>> = {
  "1": "search",
  "2": "quick-add",
  "3": "section",
};

interface AddEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appData: AppDataHandle;
  profileId: ProfileId;
  date: string;
  insertIndex?: number;
}

export function AddEntryDialog({
  open,
  onOpenChange,
  appData,
  profileId,
  date,
  insertIndex,
}: AddEntryDialogProps) {
  const { allFoods, addLogEntry, addQuickAddEntry, addSeparator } = appData;
  const [addMode, setAddMode] = useState<AddMode>("search");
  const [selectedFoodId, setSelectedFoodId] = useState<FoodId | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("grams");
  const [amount, setAmount] = useState("");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickCalories, setQuickCalories] = useState("");
  const [quickProtein, setQuickProtein] = useState("");
  const [quickSaturatedFat, setQuickSaturatedFat] = useState("");
  const [quickFiber, setQuickFiber] = useState("");
  const [sectionLabel, setSectionLabel] = useState("");
  const [highlightedSectionIndex, setHighlightedSectionIndex] = useState(0);
  const [isBudgeted, setIsBudgeted] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const quickNameInputRef = useRef<HTMLInputElement>(null);
  const sectionLabelInputRef = useRef<HTMLInputElement>(null);

  const filteredFoods = allFoods.filter((f) =>
    normalizeForSearch(f.name).includes(normalizeForSearch(search)),
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

  const quickNutrition: NutritionValues = {
    calories: Math.max(0, parseNum(quickCalories)),
    protein: Math.max(0, parseNum(quickProtein)),
    saturatedFat: Math.max(0, parseNum(quickSaturatedFat)),
    fiber: Math.max(0, parseNum(quickFiber)),
  };

  const quickHasNutrition =
    quickNutrition.calories > 0 ||
    quickNutrition.protein > 0 ||
    quickNutrition.saturatedFat > 0 ||
    quickNutrition.fiber > 0;

  const normalizedSectionLabel = normalizeForSearch(sectionLabel.trim());
  const filteredSectionPresets =
    normalizedSectionLabel.length === 0
      ? SEPARATOR_PRESETS
      : SEPARATOR_PRESETS.filter((label) =>
          normalizeForSearch(label).includes(normalizedSectionLabel),
        );
  const sectionOptions =
    filteredSectionPresets.length > 0
      ? filteredSectionPresets
      : sectionLabel.trim().length > 0
        ? [sectionLabel.trim()]
        : [];
  const sectionSubmitLabel = sectionOptions[highlightedSectionIndex] ?? "";
  const canSubmitSection = sectionSubmitLabel.trim().length > 0;

  const isDirty =
    open &&
    (selectedFoodId != null ||
      amount.trim().length > 0 ||
      notes.trim().length > 0 ||
      isBudgeted ||
      quickName.trim().length > 0 ||
      quickCalories.trim().length > 0 ||
      quickProtein.trim().length > 0 ||
      quickSaturatedFat.trim().length > 0 ||
      quickFiber.trim().length > 0 ||
      sectionLabel.trim().length > 0);

  useUnsavedChanges(isDirty, {
    title: "Discard add draft?",
    description:
      "Leaving now will lose the item you have not added to the log.",
    onDiscard: resetDraft,
  });

  useEffect(() => {
    if (!open) return;

    if (addMode === "search") {
      searchInputRef.current?.focus();
    } else if (addMode === "quick-add") {
      quickNameInputRef.current?.focus();
    } else {
      sectionLabelInputRef.current?.focus();
    }
  }, [addMode, open]);

  function resetDraft() {
    setAddMode("search");
    setSelectedFoodId(null);
    setInputMode("grams");
    setAmount("");
    setSearch("");
    setNotes("");
    setQuickName("");
    setQuickCalories("");
    setQuickProtein("");
    setQuickSaturatedFat("");
    setQuickFiber("");
    setSectionLabel("");
    setHighlightedSectionIndex(0);
    setIsBudgeted(false);
  }

  useEffect(() => {
    setHighlightedSectionIndex(0);
  }, [normalizedSectionLabel]);

  function selectAddMode(nextMode: AddMode) {
    setAddMode(nextMode);
    if (nextMode !== "search") {
      setSelectedFoodId(null);
    }
  }

  function handleAdd() {
    if (selectedFoodId == null || parsedAmount <= 0) return;
    const trimmedNotes = notes.trim();
    const entryNotes = trimmedNotes.length > 0 ? trimmedNotes : undefined;
    if (isUnitBased) {
      addLogEntry(
        profileId,
        date,
        {
          foodId: selectedFoodId,
          grams: 0,
          units: parsedAmount,
          notes: entryNotes,
          isBudgeted: isBudgeted ? true : undefined,
        },
        insertIndex,
      );
    } else {
      if (totalGrams <= 0) return;
      addLogEntry(
        profileId,
        date,
        {
          foodId: selectedFoodId,
          grams: totalGrams,
          notes: entryNotes,
          isBudgeted: isBudgeted ? true : undefined,
        },
        insertIndex,
      );
    }
    closeWithoutPrompt();
  }

  function handleQuickAdd() {
    const trimmedName = quickName.trim();
    if (trimmedName.length === 0 || !quickHasNutrition) return;

    const trimmedNotes = notes.trim();
    addQuickAddEntry(
      profileId,
      date,
      {
        type: "quick-add",
        name: trimmedName,
        nutrition: {
          calories: Math.round(quickNutrition.calories * 10) / 10,
          protein: Math.round(quickNutrition.protein * 10) / 10,
          saturatedFat: Math.round(quickNutrition.saturatedFat * 10) / 10,
          fiber: Math.round(quickNutrition.fiber * 10) / 10,
        },
        notes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
        isBudgeted: isBudgeted ? true : undefined,
      },
      insertIndex,
    );
    closeWithoutPrompt();
  }

  function handleSectionAdd(label = sectionLabel) {
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) return;

    addSeparator(profileId, date, trimmedLabel, insertIndex);
    closeWithoutPrompt();
  }

  function closeWithoutPrompt() {
    resetDraft();
    setDiscardDialogOpen(false);
    onOpenChange(false);
  }

  function selectFood(foodId: FoodId) {
    const food = allFoods.find((f) => f.id === foodId);
    setSelectedFoodId(foodId);
    const foodIsUnitBased = food?.nutritionPerUnit != null;
    setInputMode(foodIsUnitBased || food?.gramsPerUnit != null ? "units" : "grams");
    setAmount("");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }

    if (isDirty) {
      setDiscardDialogOpen(true);
      return;
    }

    closeWithoutPrompt();
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const shortcutMode = ADD_MODE_SHORTCUTS[event.key];
    if (shortcutMode == null) {
      return;
    }

    const target = event.target;
    const isEditableTarget =
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement);
    const isEmptySearchInput =
      target === searchInputRef.current && search.trim().length === 0;

    if (isEditableTarget && !isEmptySearchInput) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectAddMode(shortcutMode);
  }

  function handleSectionKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedSectionIndex((prev) =>
        sectionOptions.length === 0 ? 0 : Math.min(prev + 1, sectionOptions.length - 1),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedSectionIndex((prev) => Math.max(prev - 1, 0));
    }
  }

  const statusToggle = (
    <button
      type="button"
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
        isBudgeted
          ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-input hover:bg-accent"
      }`}
      onClick={() => setIsBudgeted((prev) => !prev)}
    >
      <span className="flex items-center gap-2">
        {isBudgeted ? (
          <CalendarCheck className="h-4 w-4" />
        ) : (
          <Utensils className="h-4 w-4" />
        )}
        {isBudgeted ? "Budgeted" : "Consumed"}
      </span>
      <span className="text-xs text-muted-foreground">
        {isBudgeted ? "planned" : "eaten"}
      </span>
    </button>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-h-[85dvh] overflow-x-hidden overflow-y-auto"
          onKeyDownCapture={handleDialogKeyDown}
        >
          <DialogHeader>
            <DialogTitle>Add</DialogTitle>
            <DialogDescription>
              Add a saved food, a one-off estimate, or a section.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2 rounded-lg bg-secondary p-1">
            {ADD_MODE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  addMode === option.mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => selectAddMode(option.mode)}
              >
                <span className="truncate">{option.label}</span>
                <span className="rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
                  {option.shortcut}
                </span>
              </button>
            ))}
          </div>

        {addMode === "quick-add" ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleQuickAdd();
            }}
          >
            {statusToggle}

            <div>
              <Label htmlFor="quick-name">Name</Label>
              <Input
                id="quick-name"
                ref={quickNameInputRef}
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                placeholder="e.g. Restaurant pasta"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="quick-calories">Calories</Label>
                <Input
                  id="quick-calories"
                  type="number"
                  value={quickCalories}
                  onChange={(e) => setQuickCalories(e.target.value)}
                  step="any"
                  min="0"
                  placeholder="kcal"
                />
              </div>
              <div>
                <Label htmlFor="quick-protein">Protein</Label>
                <Input
                  id="quick-protein"
                  type="number"
                  value={quickProtein}
                  onChange={(e) => setQuickProtein(e.target.value)}
                  step="any"
                  min="0"
                  placeholder="g"
                />
              </div>
              <div>
                <Label htmlFor="quick-saturated-fat">Sat. Fat</Label>
                <Input
                  id="quick-saturated-fat"
                  type="number"
                  value={quickSaturatedFat}
                  onChange={(e) => setQuickSaturatedFat(e.target.value)}
                  step="any"
                  min="0"
                  placeholder="g"
                />
              </div>
              <div>
                <Label htmlFor="quick-fiber">Fiber</Label>
                <Input
                  id="quick-fiber"
                  type="number"
                  value={quickFiber}
                  onChange={(e) => setQuickFiber(e.target.value)}
                  step="any"
                  min="0"
                  placeholder="g"
                />
              </div>
            </div>

            {quickHasNutrition && (
              <div className="rounded-lg bg-secondary/50 p-3 text-sm">
                <p className="mb-1 text-xs text-muted-foreground">Preview</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="font-medium text-primary">
                      {Math.round(quickNutrition.calories)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">kcal</p>
                  </div>
                  <div>
                    <p className="font-medium">
                      {Math.round(quickNutrition.protein * 10) / 10}g
                    </p>
                    <p className="text-[10px] text-muted-foreground">Protein</p>
                  </div>
                  <div>
                    <p className="font-medium">
                      {Math.round(quickNutrition.saturatedFat * 10) / 10}g
                    </p>
                    <p className="text-[10px] text-muted-foreground">Sat. Fat</p>
                  </div>
                  <div>
                    <p className="font-medium">
                      {Math.round(quickNutrition.fiber * 10) / 10}g
                    </p>
                    <p className="text-[10px] text-muted-foreground">Fiber</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="quick-notes">Notes (optional)</Label>
              <textarea
                id="quick-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. estimated at restaurant"
                className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                rows={2}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={quickName.trim().length === 0 || !quickHasNutrition}
            >
              {isBudgeted ? "Add Budgeted" : "Add to Log"}
            </Button>
          </form>
        ) : addMode === "section" ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleSectionAdd(sectionSubmitLabel);
            }}
          >
            <div className="relative">
              <Label htmlFor="section-label">Section name</Label>
              <Input
                id="section-label"
                ref={sectionLabelInputRef}
                value={sectionLabel}
                onChange={(e) => setSectionLabel(e.target.value)}
                onKeyDown={handleSectionKeyDown}
                placeholder="e.g. Late snack"
                role="combobox"
                aria-expanded="true"
                aria-controls="section-options"
                aria-autocomplete="list"
                autoFocus
              />

              <div
                id="section-options"
                className="mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
              >
                {sectionOptions.map((label, index) => {
                  const isHighlighted = index === highlightedSectionIndex;
                  const isCustom = filteredSectionPresets.length === 0;
                  return (
                    <button
                      key={`${isCustom ? "custom" : "preset"}-${label}`}
                      type="button"
                      className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm transition-colors ${
                        isHighlighted
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent"
                      }`}
                      onMouseEnter={() => setHighlightedSectionIndex(index)}
                      onClick={() => handleSectionAdd(label)}
                    >
                      <span>{label}</span>
                      {isCustom && (
                        <span className="text-xs text-muted-foreground">Custom</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={!canSubmitSection}
            >
              {canSubmitSection
                ? `Add ${sectionSubmitLabel.trim()}`
                : "Add Section"}
            </Button>
          </form>
        ) : selectedFood == null ? (
          <div className="min-w-0 space-y-3">
            <Input
              ref={searchInputRef}
              placeholder="Search foods..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            <div className="max-h-60 min-w-0 space-y-1 overflow-y-auto">
              {filteredFoods.map((food) => (
                <button
                  key={food.id}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent"
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
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleAdd();
            }}
          >
            {statusToggle}

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
                  type="button"
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
                    type="button"
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
                    type="button"
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

            <Button type="submit" className="w-full">
              {isBudgeted ? "Add Budgeted" : "Add to Log"}
            </Button>
          </form>
        )}
        </DialogContent>
      </Dialog>
      <DiscardChangesDialog
        open={discardDialogOpen}
        title="Discard add draft?"
        description="Closing now will lose the item you have not added to the log."
        onStay={() => setDiscardDialogOpen(false)}
        onDiscard={closeWithoutPrompt}
      />
    </>
  );
}
