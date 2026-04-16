import { useState } from "react";
import { Check, Plus, Trash2, Pencil, Target } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type { NutritionGoals, ProfileId, SaturatedFatMode, WakeSleepSchedule } from "../types";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PendingAction } from "./ConfirmDialog";

interface GoalsEditorProps {
  goals: NutritionGoals | null;
  schedule: WakeSleepSchedule | null;
  onSave: (goals: NutritionGoals | null, schedule: WakeSleepSchedule | null) => void;
  onClose: () => void;
}

function GoalsEditor({ goals, schedule, onSave, onClose }: GoalsEditorProps) {
  const [calories, setCalories] = useState(String(goals?.calories ?? ""));
  const [protein, setProtein] = useState(String(goals?.protein ?? ""));
  const [saturatedFat, setSaturatedFat] = useState(String(goals?.saturatedFat ?? ""));
  const [satFatMode, setSatFatMode] = useState<SaturatedFatMode>(goals?.saturatedFatMode ?? "grams");
  const [fiber, setFiber] = useState(String(goals?.fiber ?? ""));
  const [wakeHour, setWakeHour] = useState(String(schedule?.wakeHour ?? 7));
  const [sleepHour, setSleepHour] = useState(String(schedule?.sleepHour ?? 23));

  function handleSave() {
    const cal = parseFloat(calories);
    const prot = parseFloat(protein);
    const sat = parseFloat(saturatedFat);
    const fib = parseFloat(fiber);
    const wake = parseInt(wakeHour, 10);
    const sleep = parseInt(sleepHour, 10);

    const hasAnyGoal = [cal, prot, sat, fib].some((v) => !Number.isNaN(v) && v > 0);

    const newGoals: NutritionGoals | null = hasAnyGoal
      ? {
          calories: Number.isNaN(cal) ? 0 : cal,
          protein: Number.isNaN(prot) ? 0 : prot,
          saturatedFat: Number.isNaN(sat) ? 0 : sat,
          saturatedFatMode: satFatMode,
          fiber: Number.isNaN(fib) ? 0 : fib,
        }
      : null;

    const newSchedule: WakeSleepSchedule | null =
      !Number.isNaN(wake) && !Number.isNaN(sleep) && wake >= 0 && wake <= 23 && sleep >= 0 && sleep <= 23
        ? { wakeHour: wake, sleepHour: sleep }
        : null;

    onSave(newGoals, newSchedule);
    onClose();
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Daily Goals
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="goal-cal" className="text-xs">Calories (kcal)</Label>
          <Input
            id="goal-cal"
            type="number"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            placeholder="e.g. 2000"
            className="h-8 text-sm"
            step="any"
          />
        </div>
        <div>
          <Label htmlFor="goal-prot" className="text-xs">Protein (g)</Label>
          <Input
            id="goal-prot"
            type="number"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            placeholder="e.g. 120"
            className="h-8 text-sm"
            step="any"
          />
        </div>
        <div>
          <Label htmlFor="goal-sat" className="text-xs">
            Sat. Fat ({satFatMode === "grams" ? "g" : "% of kcal"})
          </Label>
          <div className="flex gap-1">
            <Input
              id="goal-sat"
              type="number"
              value={saturatedFat}
              onChange={(e) => setSaturatedFat(e.target.value)}
              placeholder={satFatMode === "grams" ? "e.g. 20" : "e.g. 10"}
              className="h-8 min-w-0 flex-1 text-sm"
              step="any"
            />
            <button
              type="button"
              className={`shrink-0 rounded-md border px-2 text-[10px] transition-colors ${
                satFatMode === "percentage"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input hover:bg-accent"
              }`}
              onClick={() => setSatFatMode(satFatMode === "grams" ? "percentage" : "grams")}
            >
              {satFatMode === "grams" ? "g" : "%"}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="goal-fib" className="text-xs">Fiber (g)</Label>
          <Input
            id="goal-fib"
            type="number"
            value={fiber}
            onChange={(e) => setFiber(e.target.value)}
            placeholder="e.g. 30"
            className="h-8 text-sm"
            step="any"
          />
        </div>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Active Hours
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="wake-hour" className="text-xs">Wake hour (0–23)</Label>
          <Input
            id="wake-hour"
            type="number"
            value={wakeHour}
            onChange={(e) => setWakeHour(e.target.value)}
            min={0}
            max={23}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="sleep-hour" className="text-xs">Sleep hour (0–23)</Label>
          <Input
            id="sleep-hour"
            type="number"
            value={sleepHour}
            onChange={(e) => setSleepHour(e.target.value)}
            min={0}
            max={23}
            className="h-8 text-sm"
          />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        The daily budget grows linearly from wake to sleep hour.
      </p>

      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave}>
          Save Goals
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface ProfileManagerProps {
  appData: AppDataHandle;
}

export function ProfileManager({ appData }: ProfileManagerProps) {
  const { data, addProfile, setActiveProfile, deleteProfile, renameProfile, updateProfileGoals } =
    appData;
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<ProfileId | null>(null);
  const [editName, setEditName] = useState("");
  const [goalsEditingId, setGoalsEditingId] = useState<ProfileId | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingAction | null>(null);

  function handleCreate() {
    const trimmed = newName.trim();
    if (trimmed.length === 0) return;
    addProfile(trimmed);
    setNewName("");
  }

  function startEditing(profileId: ProfileId, currentName: string) {
    setEditingId(profileId);
    setEditName(currentName);
  }

  function finishEditing() {
    if (editingId != null && editName.trim().length > 0) {
      renameProfile(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold">Profiles</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Create Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. My Diet, Summer Plan..."
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <Button onClick={handleCreate}>
              <Plus className="mr-1 h-4 w-4" />
              Create
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Each profile is an independent tracking context — like a separate
            notebook for tracking your intake.
          </p>
        </CardContent>
      </Card>

      {data.profiles.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No profiles yet. Create one above to start tracking.
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {data.profiles.map((profile) => {
          const isActive = data.activeProfileId === profile.id;
          const isEditing = editingId === profile.id;
          const totalDays = profile.dayLogs.length;
          const totalEntries = profile.dayLogs.reduce(
            (sum, dl) => sum + dl.entries.length,
            0,
          );

          return (
            <Card
              key={profile.id}
              className={isActive ? "border-primary/50" : ""}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") finishEditing();
                          }}
                          autoFocus
                          className="h-8"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={finishEditing}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">
                            {profile.name}
                          </p>
                          {isActive && (
                            <Badge variant="success">Active</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {totalDays} days · {totalEntries} entries
                        </p>
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex gap-1">
                      {!isActive && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setActiveProfile(profile.id as ProfileId)
                          }
                        >
                          Select
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          startEditing(
                            profile.id as ProfileId,
                            profile.name,
                          )
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setGoalsEditingId(
                            goalsEditingId === profile.id
                              ? null
                              : (profile.id as ProfileId),
                          )
                        }
                      >
                        <Target className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setPendingDelete({
                            title: "Delete profile",
                            description: `Delete profile "${profile.name}"? All its logs will be lost.`,
                            onConfirm: () =>
                              deleteProfile(profile.id as ProfileId),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
                {goalsEditingId === profile.id && (
                  <GoalsEditor
                    goals={profile.goals ?? null}
                    schedule={profile.schedule ?? null}
                    onSave={(goals, schedule) =>
                      updateProfileGoals(profile.id as ProfileId, goals, schedule)
                    }
                    onClose={() => setGoalsEditingId(null)}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ConfirmDialog
        pending={pendingDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
