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
  confirmLabel?: string;
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
        <DialogFooter className="gap-2 sm:justify-end">
          <DialogClose asChild>
            <Button variant="outline" className="w-full sm:w-auto">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={() => {
              pending?.onConfirm();
              onClose();
            }}
          >
            {pending?.confirmLabel ?? "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
