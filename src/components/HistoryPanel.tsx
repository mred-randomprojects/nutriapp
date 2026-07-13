import { formatDistanceToNow } from "date-fns";
import { Undo2, Redo2, RotateCcw } from "lucide-react";
import type { HistoryFrame } from "../useAppData";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";

interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  undoStack: ReadonlyArray<HistoryFrame>;
  redoStack: ReadonlyArray<HistoryFrame>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onUndoTo: (index: number) => void;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

export function HistoryPanel({
  open,
  onOpenChange,
  undoStack,
  redoStack,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onUndoTo,
}: HistoryPanelProps) {
  // Newest action first, but keep each frame's original index so "undo to here"
  // can address the underlying (oldest-first) stack.
  const pastNewestFirst = undoStack
    .map((frame, index) => ({ frame, index }))
    .reverse();
  // Redoable actions, next-to-redo first.
  const futureNextFirst = [...redoStack].reverse();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>
            Your recent actions. Undoing restores the app to exactly how it was
            before that action.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 className="mr-1.5 h-4 w-4" />
            Undo
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 className="mr-1.5 h-4 w-4" />
            Redo
          </Button>
        </div>

        {pastNewestFirst.length === 0 && futureNextFirst.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No actions yet in this session.
          </p>
        )}

        {pastNewestFirst.length > 0 && (
          <div className="space-y-1">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Done
            </p>
            {pastNewestFirst.map(({ frame, index }, position) => {
              const isNext = position === 0;
              return (
                <button
                  key={`${frame.at}-${index}`}
                  type="button"
                  className="group flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors hover:border-input hover:bg-accent"
                  onClick={() => onUndoTo(index)}
                  title={
                    isNext
                      ? "Undo this action"
                      : "Undo this and everything after it"
                  }
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {isNext && (
                      <RotateCcw className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="truncate">{frame.label}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(frame.at)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {futureNextFirst.length > 0 && (
          <div className="space-y-1">
            <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Undone (redoable)
            </p>
            {futureNextFirst.map((frame, position) => (
              <div
                key={`redo-${frame.at}-${position}`}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground"
              >
                <span className="truncate line-through">{frame.label}</span>
                <span className="shrink-0 text-xs">{relativeTime(frame.at)}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
