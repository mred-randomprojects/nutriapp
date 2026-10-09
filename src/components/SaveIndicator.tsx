import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { SaveStatus } from "../useAppData";

/** How long "Saved" stays up after a change lands. */
const SAVED_VISIBLE_MS = 1500;

/**
 * A small pill confirming that the latest change was written: "Saving…"
 * while the cloud write is out, then "Saved" once it lands, then nothing.
 * Failures are not shown here; the cloud-sync banner owns those.
 */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);

  useEffect(() => {
    if (status.kind !== "saved") return;
    const timer = window.setTimeout(
      () => setHiddenAt(status.at),
      SAVED_VISIBLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [status]);

  if (status.kind === "idle") return null;
  if (status.kind === "saved" && hiddenAt === status.at) return null;

  return (
    <div className="mb-2 flex justify-center">
      <p
        role="status"
        className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground shadow-sm"
      >
        {status.kind === "saving" ? (
          "Saving…"
        ) : (
          <>
            <Check className="h-3 w-3" aria-hidden="true" />
            Saved
          </>
        )}
      </p>
    </div>
  );
}
