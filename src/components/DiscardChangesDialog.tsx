import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";

interface DiscardChangesDialogProps {
  open: boolean;
  title?: string;
  description?: string;
  onStay: () => void;
  onDiscard: () => void;
}

export function DiscardChangesDialog({
  open,
  title = "Discard unsaved changes?",
  description = "Leaving now will lose the changes you have not saved.",
  onStay,
  onDiscard,
}: DiscardChangesDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onStay();
      }}
    >
      <DialogContent className="max-w-xs rounded-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            className="flex-1 sm:flex-initial"
            onClick={onStay}
          >
            Stay
          </Button>
          <Button
            variant="destructive"
            className="flex-1 sm:flex-initial"
            onClick={onDiscard}
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
