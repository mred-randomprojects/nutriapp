import { useState, useMemo } from "react";
import { format, addDays, subDays } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AppDataHandle } from "../appDataType";
import type { LogEntryId, ProfileId } from "../types";
import { nutritionForEntry, sumNutrition } from "../nutrition";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { AddEntryDialog } from "./AddEntryDialog";

interface DailyLogProps {
  appData: AppDataHandle;
}

function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function isToday(date: Date): boolean {
  return formatDate(date) === formatDate(new Date());
}

export function DailyLog({ appData }: DailyLogProps) {
  const navigate = useNavigate();
  const { activeProfile, foodsMap, data, removeLogEntry } = appData;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const dateStr = formatDate(selectedDate);

  const dayLog = useMemo(() => {
    if (activeProfile == null) return undefined;
    return activeProfile.dayLogs.find((dl) => dl.date === dateStr);
  }, [activeProfile, dateStr]);

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

  if (data.foods.length === 0) {
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
        <Button size="sm" onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add Entry
        </Button>
      </div>

      {(dayLog == null || dayLog.entries.length === 0) && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No entries for this day yet.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {dayLog?.entries.map((entry) => {
          const food = foodsMap.get(entry.foodId);
          if (food == null) return null;
          const entryNutrition = nutritionForEntry(entry, food);

          const subtitle =
            food.gramsPerUnit != null && entry.grams % food.gramsPerUnit === 0
              ? `${entry.grams / food.gramsPerUnit} unit${entry.grams / food.gramsPerUnit !== 1 ? "s" : ""} (${entry.grams}g)`
              : `${entry.grams}g`;

          return (
            <Card key={entry.id}>
              <CardContent className="flex items-center gap-3 p-3">
                {food.imageUrl != null ? (
                  <img
                    src={food.imageUrl}
                    alt={food.name}
                    className="h-10 w-10 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-sm">
                    🍽️
                  </div>
                )}
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
                  onClick={() =>
                    removeLogEntry(
                      activeProfile.id as ProfileId,
                      dateStr,
                      entry.id as LogEntryId,
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
