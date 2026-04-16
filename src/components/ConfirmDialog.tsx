import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";

export interface PendingAction {
  title: string;
  description: string;
  onConfirm: () => void;
}

interface ConfirmDialogProps {
  pending: PendingAction | null;
  onClose: () => void;
}

export function ConfirmDialog({ pending, onClose }: ConfirmDialogProps) {
  return (
    <Dialog
      open={pending != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-xs rounded-xl">
        <DialogHeader>
          <DialogTitle>{pending?.title}</DialogTitle>
          <DialogDescription>{pending?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <DialogClose asChild>
            <Button variant="outline" className="flex-1 sm:flex-initial">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            className="flex-1 sm:flex-initial"
            onClick={() => {
              pending?.onConfirm();
              onClose();
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
