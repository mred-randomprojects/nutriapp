import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { AlertTriangle, ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type {
  DayLogItem,
  LogEntry,
  LogEntryId,
  MealPlanId,
  NutritionValues,
  ProfileId,
  QuickAddEntry,
} from "../types";
import { sumNutrition } from "../nutrition";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { AddEntryDialog } from "./AddEntryDialog";
import { useUnsavedChanges } from "../unsavedChanges";
import {
  FoodEntryCard,
  QuickAddEntryCard,
  SectionSubtotal,
  SortableItem,
} from "./DailyLog";
import {
  canRepeatDailyLogKeyboardAction,
  emptyEntrySelection,
  getDailyLogKeyboardAction,
  getKeyboardAddEntryInsertIndex,
  getVisibleEntryIds,
  moveEntrySelection,
  moveSelectedItems,
  normalizeEntrySelection,
  selectAfterRemovingEntries,
  selectEntry,
  toggleBudgetedForSelectedItems,
  type EntrySelectionState,
} from "./dailyLogKeyboard";

interface PlanEditorProps {
  appData: AppDataHandle;
}

const NO_COLLAPSED_SECTIONS: ReadonlySet<LogEntryId> = new Set();

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement)
  );
}

function TotalsRow({ totals }: { totals: NutritionValues }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-center">
      <div className="rounded-lg border bg-background/60 px-2 py-2">
        <p className="text-lg font-bold text-primary">
          {Math.round(totals.calories)}
        </p>
        <p className="text-[10px] text-muted-foreground">kcal</p>
      </div>
      <div className="rounded-lg border bg-background/60 px-2 py-2">
        <p className="text-lg font-bold">{formatNumber(totals.protein)}g</p>
        <p className="text-[10px] text-muted-foreground">Protein</p>
      </div>
      <div className="rounded-lg border bg-background/60 px-2 py-2">
        <p className="text-lg font-bold">{formatNumber(totals.saturatedFat)}g</p>
        <p className="text-[10px] text-muted-foreground">Sat. Fat</p>
      </div>
      <div className="rounded-lg border bg-background/60 px-2 py-2">
        <p className="text-lg font-bold">{formatNumber(totals.fiber)}g</p>
        <p className="text-[10px] text-muted-foreground">Fiber</p>
      </div>
    </div>
  );
}

export function PlanEditor({ appData }: PlanEditorProps) {
  const navigate = useNavigate();
  const { planId: planIdParam } = useParams<{ planId: string }>();
  const { activeProfile, foodsMap, updateMealPlan } = appData;

  const plan = useMemo(
    () =>
      activeProfile?.mealPlans?.find((p) => p.id === planIdParam) ?? null,
    [activeProfile?.mealPlans, planIdParam],
  );

  const [name, setName] = useState(plan?.name ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [entries, setEntries] = useState<DayLogItem[]>(
    plan != null ? plan.entries.map((entry) => ({ ...entry })) : [],
  );
  const [entrySelection, setEntrySelection] =
    useState<EntrySelectionState>(emptyEntrySelection);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addEntryInsertIndex, setAddEntryInsertIndex] = useState<
    number | undefined
  >(undefined);
  const [editEntryRequest, setEditEntryRequest] = useState<{
    entryId: LogEntryId;
    nonce: number;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nextEditNonce = useRef(0);
  const entryRowRefs = useRef(new Map<LogEntryId, HTMLElement | null>());

  // Re-seed the draft if the underlying plan identity changes (e.g. after the
  // cloud sync loads a plan that was not present on first render).
  const seededPlanId = useRef<string | null>(null);
  useEffect(() => {
    if (plan == null || seededPlanId.current === plan.id) return;
    seededPlanId.current = plan.id;
    setName(plan.name);
    setDescription(plan.description ?? "");
    setEntries(plan.entries.map((entry) => ({ ...entry })));
    setEntrySelection(emptyEntrySelection);
  }, [plan]);

  const originalName = plan?.name ?? "";
  const originalDescription = plan?.description ?? "";
  const originalEntriesKey = useMemo(
    () => JSON.stringify(plan?.entries ?? []),
    [plan?.entries],
  );
  const currentEntriesKey = useMemo(
    () => JSON.stringify(entries),
    [entries],
  );
  const isDirty =
    !saved &&
    plan != null &&
    (name !== originalName ||
      description !== originalDescription ||
      currentEntriesKey !== originalEntriesKey);

  const clearUnsavedChanges = useUnsavedChanges(isDirty, {
    title: "Discard plan changes?",
    description: "Leaving now will lose the plan edits you have not saved.",
  });

  const visibleEntryIds = useMemo(
    () => getVisibleEntryIds(entries, NO_COLLAPSED_SECTIONS),
    [entries],
  );
  const selectedEntryIdSet = useMemo(
    () => new Set(entrySelection.selectedIds),
    [entrySelection.selectedIds],
  );

  const totals = useMemo(
    () => sumNutrition(entries, foodsMap),
    [entries, foodsMap],
  );

  // Per-section subtotals keyed by the separator id that opens the section.
  const sectionSubtotals = useMemo(() => {
    const map = new Map<LogEntryId, NutritionValues>();
    let currentSeparatorId: LogEntryId | null = null;
    let bucket: DayLogItem[] = [];
    const flush = () => {
      if (currentSeparatorId != null) {
        map.set(currentSeparatorId, sumNutrition(bucket, foodsMap));
      }
    };
    for (const item of entries) {
      if (item.type === "separator") {
        flush();
        currentSeparatorId = item.id as LogEntryId;
        bucket = [];
        continue;
      }
      bucket.push(item);
    }
    flush();
    return map;
  }, [entries, foodsMap]);

  const setEntryRowRef = useCallback(
    (id: LogEntryId, node: HTMLElement | null) => {
      if (node == null) {
        entryRowRefs.current.delete(id);
      } else {
        entryRowRefs.current.set(id, node);
      }
    },
    [],
  );

  const selectVisibleEntry = useCallback(
    (id: LogEntryId) => {
      setEntrySelection(selectEntry(id, visibleEntryIds));
    },
    [visibleEntryIds],
  );

  const openAddEntry = useCallback((insertIndex?: number) => {
    setAddEntryInsertIndex(insertIndex);
    setAddDialogOpen(true);
  }, []);

  const addItem = useCallback((item: DayLogItem, insertIndex?: number) => {
    setEntries((prev) => {
      if (insertIndex == null) return [...prev, item];
      const safeIndex = Math.max(0, Math.min(insertIndex, prev.length));
      return [...prev.slice(0, safeIndex), item, ...prev.slice(safeIndex)];
    });
  }, []);

  const removeEntries = useCallback(
    (ids: ReadonlyArray<LogEntryId>) => {
      const idSet = new Set(ids);
      if (idSet.size === 0) return;
      setEntrySelection((prev) =>
        selectAfterRemovingEntries(prev, visibleEntryIds, idSet),
      );
      setEntries((prev) => prev.filter((entry) => !idSet.has(entry.id)));
    },
    [visibleEntryIds],
  );

  const updateEntry = useCallback(
    (id: LogEntryId, updates: Partial<Omit<LogEntry, "id" | "type">>) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.type !== "separator" &&
          entry.type !== "quick-add" &&
          entry.id === id
            ? { ...entry, ...updates }
            : entry,
        ),
      );
    },
    [],
  );

  const updateQuickAdd = useCallback(
    (id: LogEntryId, updates: Partial<Omit<QuickAddEntry, "id" | "type">>) => {
      setEntries((prev) =>
        prev.map((entry) =>
          entry.type === "quick-add" && entry.id === id
            ? { ...entry, ...updates }
            : entry,
        ),
      );
    },
    [],
  );

  const toggleBudgetedForSelection = useCallback(() => {
    if (entrySelection.selectedIds.length === 0) return;
    setEntries((prev) =>
      toggleBudgetedForSelectedItems(prev, entrySelection.selectedIds),
    );
  }, [entrySelection.selectedIds]);

  const moveSelection = useCallback(
    (direction: "up" | "down") => {
      if (entrySelection.selectedIds.length === 0) return;
      setEntries((prev) =>
        moveSelectedItems(prev, entrySelection.selectedIds, direction),
      );
    },
    [entrySelection.selectedIds],
  );

  const requestEditSelectedEntry = useCallback(() => {
    const normalized = normalizeEntrySelection(entrySelection, visibleEntryIds);
    const focusedId = normalized.focusedId;
    if (focusedId == null) return;
    const item = entries.find((entry) => entry.id === focusedId);
    if (item == null || item.type === "separator") return;
    nextEditNonce.current += 1;
    setEditEntryRequest({ entryId: focusedId, nonce: nextEditNonce.current });
  }, [entries, entrySelection, visibleEntryIds]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over == null || active.id === over.id) return;
    setEntries((prev) => {
      const oldIndex = prev.findIndex((entry) => entry.id === active.id);
      const newIndex = prev.findIndex((entry) => entry.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      if (addDialogOpen) return;

      const action = getDailyLogKeyboardAction(e);
      if (action == null) {
        if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          if (!e.repeat) openAddEntry();
        }
        return;
      }

      e.preventDefault();
      if (e.repeat && !canRepeatDailyLogKeyboardAction(action)) return;

      if (action.type === "select") {
        setEntrySelection((prev) =>
          moveEntrySelection(prev, visibleEntryIds, action.direction, action.extend),
        );
      } else if (action.type === "move-selection") {
        moveSelection(action.direction);
      } else if (action.type === "delete-selection") {
        removeEntries(entrySelection.selectedIds);
      } else if (action.type === "edit-selection") {
        requestEditSelectedEntry();
      } else if (action.type === "clear-selection") {
        setEntrySelection(emptyEntrySelection);
      } else if (action.type === "toggle-budgeted") {
        toggleBudgetedForSelection();
      } else if (action.type === "add-below") {
        openAddEntry(getKeyboardAddEntryInsertIndex(entries, entrySelection));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    addDialogOpen,
    entries,
    entrySelection,
    moveSelection,
    openAddEntry,
    removeEntries,
    requestEditSelectedEntry,
    toggleBudgetedForSelection,
    visibleEntryIds,
  ]);

  const entryIds = useMemo(() => entries.map((entry) => entry.id), [entries]);

  const goBack = useCallback(() => {
    navigate("/plans");
  }, [navigate]);

  const handleSave = useCallback(() => {
    if (activeProfile == null || plan == null) return;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setSaveError("Give the plan a name.");
      return;
    }
    const didSave = updateMealPlan(
      activeProfile.id as ProfileId,
      plan.id as MealPlanId,
      {
        name: trimmedName,
        description,
        entries,
      },
    );
    if (!didSave) {
      setSaveError("Another plan already uses that name.");
      return;
    }
    // Clear the unsaved-changes source before navigating so the route blocker
    // does not prompt to discard the edits we just committed.
    flushSync(() => {
      setSaved(true);
      clearUnsavedChanges();
    });
    goBack();
  }, [
    activeProfile,
    clearUnsavedChanges,
    description,
    entries,
    goBack,
    name,
    plan,
    updateMealPlan,
  ]);

  if (activeProfile == null || plan == null) {
    return (
      <div className="p-4">
        <Button variant="ghost" size="sm" onClick={goBack} className="mb-4">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Plans
        </Button>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            This plan could not be found.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={name.trim().length === 0}>
          <Save className="mr-1 h-4 w-4" />
          Save
        </Button>
      </div>

      <div className="mb-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="plan-name">Name</Label>
          <Input
            id="plan-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaveError(null);
            }}
            placeholder="Plan name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-description">Description</Label>
          <textarea
            id="plan-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this plan for? When would you use it?"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={2}
          />
        </div>
        {saveError != null && (
          <p className="text-sm text-destructive">{saveError}</p>
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <TotalsRow totals={totals} />
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Entries</h2>
        <Button size="sm" variant="outline" onClick={() => openAddEntry()}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No entries yet. Use “Add” to build this plan.
          </CardContent>
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={entryIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {entries.map((item, index) => {
                const nextItem = entries[index + 1];
                const isLastBeforeNextSection =
                  nextItem?.type === "separator" ||
                  index === entries.length - 1;
                const showSubtotal =
                  item.type !== "separator" && isLastBeforeNextSection;

                let currentSeparatorId: LogEntryId | null = null;
                for (let i = index; i >= 0; i--) {
                  const prev = entries[i];
                  if (prev.type === "separator") {
                    currentSeparatorId = prev.id as LogEntryId;
                    break;
                  }
                }
                const subtotal =
                  showSubtotal && currentSeparatorId != null
                    ? sectionSubtotals.get(currentSeparatorId)
                    : undefined;

                if (item.type === "separator") {
                  return (
                    <SortableItem
                      key={item.id}
                      item={item}
                      isLocked={false}
                      isSelected={selectedEntryIdSet.has(item.id)}
                      isFocused={entrySelection.focusedId === item.id}
                      onSelect={() => selectVisibleEntry(item.id as LogEntryId)}
                      onNodeRef={(node) =>
                        setEntryRowRef(item.id as LogEntryId, node)
                      }
                    >
                      <div className="flex w-full items-center gap-2 pt-2 first:pt-0">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {item.label}
                        </span>
                        <div className="h-px flex-1 bg-border" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="Remove section"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeEntries([item.id as LogEntryId]);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </SortableItem>
                  );
                }

                if (item.type === "quick-add") {
                  return (
                    <SortableItem
                      key={item.id}
                      item={item}
                      isLocked={false}
                      isSelected={selectedEntryIdSet.has(item.id)}
                      isFocused={entrySelection.focusedId === item.id}
                      onSelect={() => selectVisibleEntry(item.id as LogEntryId)}
                      onNodeRef={(node) =>
                        setEntryRowRef(item.id as LogEntryId, node)
                      }
                    >
                      <QuickAddEntryCard
                        item={item}
                        isLocked={false}
                        editRequestNonce={
                          editEntryRequest?.entryId === item.id
                            ? editEntryRequest.nonce
                            : null
                        }
                        onAddAbove={() => openAddEntry(index)}
                        onAddBelow={() => openAddEntry(index + 1)}
                        onRemove={() => removeEntries([item.id as LogEntryId])}
                        onUpdate={(updates) =>
                          updateQuickAdd(item.id as LogEntryId, updates)
                        }
                        onToggleBudgeted={() =>
                          updateQuickAdd(item.id as LogEntryId, {
                            isBudgeted: item.isBudgeted === true ? undefined : true,
                          })
                        }
                      />
                      {subtotal != null && <SectionSubtotal totals={subtotal} />}
                    </SortableItem>
                  );
                }

                const food = foodsMap.get(item.foodId);
                if (food == null) {
                  return (
                    <SortableItem
                      key={item.id}
                      item={item}
                      isLocked={false}
                      isSelected={selectedEntryIdSet.has(item.id)}
                      isFocused={entrySelection.focusedId === item.id}
                      onSelect={() => selectVisibleEntry(item.id as LogEntryId)}
                      onNodeRef={(node) =>
                        setEntryRowRef(item.id as LogEntryId, node)
                      }
                    >
                      <Card className="border-dashed opacity-60">
                        <CardContent className="flex items-center gap-3 p-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                            <AlertTriangle className="h-5 w-5 text-destructive" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              Deleted food
                            </p>
                            <p className="text-xs text-muted-foreground">
                              This food no longer exists in your database
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Remove entry"
                            onClick={() => removeEntries([item.id as LogEntryId])}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </CardContent>
                      </Card>
                      {subtotal != null && <SectionSubtotal totals={subtotal} />}
                    </SortableItem>
                  );
                }

                return (
                  <SortableItem
                    key={item.id}
                    item={item}
                    isLocked={false}
                    isSelected={selectedEntryIdSet.has(item.id)}
                    isFocused={entrySelection.focusedId === item.id}
                    onSelect={() => selectVisibleEntry(item.id as LogEntryId)}
                    onNodeRef={(node) =>
                      setEntryRowRef(item.id as LogEntryId, node)
                    }
                  >
                    <FoodEntryCard
                      item={item}
                      food={food}
                      isLocked={false}
                      editRequestNonce={
                        editEntryRequest?.entryId === item.id
                          ? editEntryRequest.nonce
                          : null
                      }
                      onAddAbove={() => openAddEntry(index)}
                      onAddBelow={() => openAddEntry(index + 1)}
                      onRemove={() => removeEntries([item.id as LogEntryId])}
                      onUpdate={(updates) =>
                        updateEntry(item.id as LogEntryId, updates)
                      }
                      onToggleBudgeted={() =>
                        updateEntry(item.id as LogEntryId, {
                          isBudgeted: item.isBudgeted === true ? undefined : true,
                        })
                      }
                    />
                    {subtotal != null && <SectionSubtotal totals={subtotal} />}
                  </SortableItem>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AddEntryDialog
        open={addDialogOpen}
        onOpenChange={(open) => {
          setAddDialogOpen(open);
          if (!open) setAddEntryInsertIndex(undefined);
        }}
        appData={appData}
        onAddItem={addItem}
        insertIndex={addEntryInsertIndex}
      />
    </div>
  );
}
