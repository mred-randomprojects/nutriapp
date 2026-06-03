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
import { useRef } from "react";

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
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  function confirmPendingAction() {
    pending?.onConfirm();
    onClose();
  }

  return (
    <Dialog
      open={pending != null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-xs rounded-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
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
            ref={confirmButtonRef}
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={confirmPendingAction}
          >
            {pending?.confirmLabel ?? "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
