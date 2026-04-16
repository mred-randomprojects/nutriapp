import { useState } from "react";
import { Check, Plus, Trash2, Pencil } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import type { ProfileId } from "../types";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PendingAction } from "./ConfirmDialog";

interface ProfileManagerProps {
  appData: AppDataHandle;
}

export function ProfileManager({ appData }: ProfileManagerProps) {
  const { data, addProfile, setActiveProfile, deleteProfile, renameProfile } =
    appData;
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<ProfileId | null>(null);
  const [editName, setEditName] = useState("");
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
