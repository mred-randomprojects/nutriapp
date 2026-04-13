import { useState, useMemo } from "react";
import { format, addDays, subDays } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  GripVertical,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AppDataHandle } from "../appDataType";
import type { DayLogItem, Food, LogEntry, LogEntryId, ProfileId } from "../types";
import { nutritionForEntry, sumNutrition } from "../nutrition";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { AddEntryDialog } from "./AddEntryDialog";

const SEPARATOR_PRESETS = ["Breakfast", "Lunch", "Merienda", "Dinner", "Snack"];

interface DailyLogProps {
  appData: AppDataHandle;
}

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function isToday(date: Date): boolean {
  return formatDate(date) === formatDate(new Date());
}

interface SortableItemProps {
  item: DayLogItem;
  children: React.ReactNode;
}

function SortableItem({ item, children }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-1 ${isDragging ? "z-10 opacity-50" : ""}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
    >
      <button
        className="touch-none p-1 text-muted-foreground"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// DUPLICATED: also defined in AddEntryDialog.tsx
type InputMode = "grams" | "units";

interface FoodEntryCardProps {
  item: LogEntry;
  food: Food;
  onRemove: () => void;
  onUpdateGrams: (grams: number) => void;
}

function FoodEntryCard({ item, food, onRemove, onUpdateGrams }: FoodEntryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>("grams");

  const entryNutrition = nutritionForEntry(item, food);
  const gramsPerUnit = food.gramsPerUnit;
  const unitCount =
    gramsPerUnit != null && item.grams % gramsPerUnit === 0
      ? item.grams / gramsPerUnit
      : null;

  const subtitle =
    unitCount != null
      ? `${unitCount} unit${unitCount !== 1 ? "s" : ""} (${item.grams}g)`
      : `${item.grams}g`;

  function startEditing() {
    if (unitCount != null && gramsPerUnit != null) {
      setInputMode("units");
      setEditValue(String(unitCount));
    } else {
      setInputMode("grams");
      setEditValue(String(item.grams));
    }
    setIsEditing(true);
  }

  function commitEdit() {
    const parsed = parseFloat(editValue);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setIsEditing(false);
      return;
    }
    const newGrams =
      inputMode === "units" && gramsPerUnit != null
        ? parsed * gramsPerUnit
        : parsed;
    if (newGrams !== item.grams) {
      onUpdateGrams(newGrams);
    }
    setIsEditing(false);
  }

  function switchMode(mode: InputMode) {
    const parsed = parseFloat(editValue);
    if (!Number.isNaN(parsed) && parsed > 0 && gramsPerUnit != null) {
      setEditValue(
        String(mode === "units" ? parsed / gramsPerUnit : parsed * gramsPerUnit),
      );
    }
    setInputMode(mode);
  }

  const foodImage =
    food.imageUrl != null ? (
      <img
        src={food.imageUrl}
        alt={food.name}
        className="h-10 w-10 rounded-lg object-cover"
      />
    ) : (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-sm">
        🍽️
      </div>
    );

  if (isEditing) {
    return (
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            {foodImage}
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {food.name}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
          {gramsPerUnit != null && (
            <div className="mt-2 flex gap-2">
              <button
                className={`flex-1 rounded-lg border px-3 py-1 text-xs transition-colors ${
                  inputMode === "grams"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-accent"
                }`}
                onClick={() => switchMode("grams")}
              >
                Grams
              </button>
              <button
                className={`flex-1 rounded-lg border px-3 py-1 text-xs transition-colors ${
                  inputMode === "units"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input hover:bg-accent"
                }`}
                onClick={() => switchMode("units")}
              >
                Units ({gramsPerUnit}g)
              </button>
            </div>
          )}
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              commitEdit();
            }}
          >
            <Input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-8 text-sm"
              min={0.1}
              step={inputMode === "grams" ? 1 : 0.5}
              autoFocus
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {inputMode === "grams" ? "g" : "units"}
            </span>
            <Button type="submit" size="sm" className="h-8 shrink-0">
              Save
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={startEditing}
    >
      <CardContent className="flex items-center gap-3 p-3">
        {foodImage}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{food.name}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="text-right text-xs">
          <p className="font-medium text-primary">
            {Math.round(entryNutrition.calories)} kcal
          </p>
          <p className="text-muted-foreground">
            {entryNutrition.protein}g prot
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </CardContent>
    </Card>
  );
}

export function DailyLog({ appData }: DailyLogProps) {
  const navigate = useNavigate();
  const {
    activeProfile,
    foodsMap,
    allFoods,
    addSeparator,
    removeLogEntry,
    reorderLogEntries,
    updateLogEntry,
  } = appData;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");

  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 5 },
  });
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const dateStr = formatDate(selectedDate);

  const dayLog = useMemo(() => {
    if (activeProfile == null) return undefined;
    return activeProfile.dayLogs.find((dl) => dl.date === dateStr);
  }, [activeProfile, dateStr]);

  const entryIds = useMemo(
    () => dayLog?.entries.map((e) => e.id) ?? [],
    [dayLog],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over == null || active.id === over.id || dayLog == null) return;

    const oldIndex = dayLog.entries.findIndex((e) => e.id === active.id);
    const newIndex = dayLog.entries.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(dayLog.entries, oldIndex, newIndex);
    reorderLogEntries(activeProfile!.id, dateStr, reordered);
  }

  const totals = useMemo(() => {
    if (dayLog == null) {
      return { calories: 0, protein: 0, saturatedFat: 0, fiber: 0 };
    }
    return sumNutrition(dayLog.entries, foodsMap);
  }, [dayLog, foodsMap]);

  if (activeProfile == null) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="mb-3">
              No profile selected. Create one to start tracking.
            </p>
            <Button onClick={() => navigate("/profiles")}>
              Go to Profiles
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (allFoods.length === 0) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="mb-3">
              No foods in your database yet. Add some foods first.
            </p>
            <Button onClick={() => navigate("/foods/new")}>
              Add First Food
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Date navigation */}
      <div className="mb-4 flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSelectedDate(subDays(selectedDate, 1))}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="text-center">
          <button
            className="text-lg font-bold hover:text-primary"
            onClick={() => setSelectedDate(new Date())}
          >
            {format(selectedDate, "EEE, MMM d")}
          </button>
          {isToday(selectedDate) && (
            <Badge variant="success" className="ml-2">
              Today
            </Badge>
          )}
          <p className="text-xs text-muted-foreground">
            {activeProfile.name}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSelectedDate(addDays(selectedDate, 1))}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Daily totals */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Daily Totals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-lg font-bold text-primary">
                {Math.round(totals.calories)}
              </p>
              <p className="text-[10px] text-muted-foreground">kcal</p>
            </div>
            <div>
              <p className="text-lg font-bold">{totals.protein}g</p>
              <p className="text-[10px] text-muted-foreground">Protein</p>
            </div>
            <div>
              <p className="text-lg font-bold">{totals.saturatedFat}g</p>
              <p className="text-[10px] text-muted-foreground">Sat. Fat</p>
            </div>
            <div>
              <p className="text-lg font-bold">{totals.fiber}g</p>
              <p className="text-[10px] text-muted-foreground">Fiber</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entries list */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Entries</h2>
        <div className="flex gap-2">
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSectionMenuOpen(!sectionMenuOpen)}
            >
              Section
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
            {sectionMenuOpen && (
              <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border bg-popover p-2 shadow-lg">
                {SEPARATOR_PRESETS.map((label) => (
                  <button
                    key={label}
                    className="w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      addSeparator(
                        activeProfile.id as ProfileId,
                        dateStr,
                        label,
                      );
                      setSectionMenuOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <div className="mt-1 border-t pt-1">
                  <form
                    className="flex gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const trimmed = customLabel.trim();
                      if (trimmed.length === 0) return;
                      addSeparator(
                        activeProfile.id as ProfileId,
                        dateStr,
                        trimmed,
                      );
                      setCustomLabel("");
                      setSectionMenuOpen(false);
                    }}
                  >
                    <Input
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="Custom…"
                      className="h-7 text-sm"
                      autoFocus
                    />
                    <Button type="submit" size="sm" className="h-7 px-2">
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </div>
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add Entry
          </Button>
        </div>
      </div>

      {(dayLog == null || dayLog.entries.length === 0) && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No entries for this day yet.
          </CardContent>
        </Card>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {dayLog?.entries.map((item) => {
              if (item.type === "separator") {
                return (
                  <SortableItem key={item.id} item={item}>
                    <div className="flex items-center gap-2 pt-2 first:pt-0">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {item.label}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() =>
                          removeLogEntry(
                            activeProfile.id as ProfileId,
                            dateStr,
                            item.id as LogEntryId,
                          )
                        }
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </SortableItem>
                );
              }

              const food = foodsMap.get(item.foodId);
              if (food == null) return null;

              return (
                <SortableItem key={item.id} item={item}>
                  <FoodEntryCard
                    item={item}
                    food={food}
                    onRemove={() =>
                      removeLogEntry(
                        activeProfile.id as ProfileId,
                        dateStr,
                        item.id as LogEntryId,
                      )
                    }
                    onUpdateGrams={(grams) =>
                      updateLogEntry(
                        activeProfile.id as ProfileId,
                        dateStr,
                        item.id as LogEntryId,
                        { grams },
                      )
                    }
                  />
                </SortableItem>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <AddEntryDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        appData={appData}
        profileId={activeProfile.id}
        date={dateStr}
      />
    </div>
  );
}
