import {
  ORIGIN_QUOTA_BYTES,
  formatBytes,
  isNutriAppKey,
  storageSpaceMessage,
  storageUsage,
} from "../storageQuota";
import { Progress } from "./ui/progress";

export function StorageUsage() {
  // The ~5 MB is shared by every app on mred-randomprojects.github.io, so the
  // bar shows the site's total and the label says whose bytes they are.
  const split = storageUsage(isNutriAppKey);
  const usedBytes = split.mine + split.others;
  const percentage = Math.min((usedBytes / ORIGIN_QUOTA_BYTES) * 100, 100);
  const isNearFull = percentage > 80;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted-foreground">
        <span>
          NutriApp {formatBytes(split.mine)} · other apps {formatBytes(split.others)}
        </span>
        <span>
          {Math.round(percentage)}% of {formatBytes(ORIGIN_QUOTA_BYTES)}
        </span>
      </div>
      <Progress
        value={percentage}
        className={isNearFull ? "[&>div]:bg-destructive" : ""}
      />
      {isNearFull && (
        <p className="text-[10px] text-destructive">
          {storageSpaceMessage(split, "almost-full")}
        </p>
      )}
    </div>
  );
}
