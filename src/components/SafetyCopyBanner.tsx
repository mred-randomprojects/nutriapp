import { format, parseISO } from "date-fns";
import { describeDataLoss } from "../dataLoss";
import type { SafetyNotice } from "../syncEngine";
import { Button } from "./ui/button";

/**
 * Shown while a pull has taken away something no delete explains (an old
 * version of the app writing its older copy, a bad write) and a copy from
 * just before is kept. Ordinary deletes made on another device never show it. Restore brings back what is missing, on
 * every device, as one undoable action; Dismiss forgets the copy.
 */
export function SafetyCopyBanner({
  notice,
  onRestore,
  onDismiss,
}: {
  notice: SafetyNotice;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="fixed left-1/2 top-2 z-40 w-[calc(100%-1rem)] max-w-lg -translate-x-1/2 rounded-md border bg-background p-3 text-sm shadow-md"
    >
      <p>
        Syncing removed {describeDataLoss(notice.loss)} from this device without a delete, most
        likely an older version of the app still open somewhere. A copy from {format(parseISO(notice.savedAt), "MMM d, HH:mm")} is kept
        {notice.persisted ? "" : " until you close the app"}.
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
        <Button size="sm" onClick={onRestore}>
          Restore it
        </Button>
      </div>
    </div>
  );
}
