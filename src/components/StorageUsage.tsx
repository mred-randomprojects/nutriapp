import { getStorageUsage } from "../storage";
import { Progress } from "./ui/progress";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export function StorageUsage() {
  const { usedBytes, quotaBytes } = getStorageUsage();
  const percentage = Math.min((usedBytes / quotaBytes) * 100, 100);
  const isNearFull = percentage > 80;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Local storage</span>
        <span>
          {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
        </span>
      </div>
      <Progress
        value={percentage}
        className={isNearFull ? "[&>div]:bg-destructive" : ""}
      />
      {isNearFull && (
        <p className="text-[10px] text-destructive">
          Storage is almost full — consider exporting and deleting old profiles.
        </p>
      )}
    </div>
  );
}
