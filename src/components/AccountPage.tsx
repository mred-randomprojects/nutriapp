import { useState } from "react";
import { useAuth } from "../auth";
import { Download, LogOut } from "lucide-react";
import type { AppDataHandle } from "../appDataType";
import { downloadBackup } from "../downloadBackup";

interface AccountPageProps {
  appData: AppDataHandle;
}

export function AccountPage({ appData }: AccountPageProps) {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (user == null) return null;

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
  };

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-lg font-semibold">Account</h1>

      <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
        {user.photoURL != null ? (
          <img
            src={user.photoURL}
            alt=""
            className="h-12 w-12 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-lg font-medium text-secondary-foreground">
            {(user.displayName ?? user.email ?? "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {user.displayName != null && (
            <p className="truncate font-medium">{user.displayName}</p>
          )}
          {user.email != null && (
            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => downloadBackup(appData.data)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          <Download className="h-4 w-4" />
          Download backup (JSON)
        </button>
        <p className="text-xs text-muted-foreground">
          Every food, profile, log and plan on this device, in one file. Keep it
          somewhere other than this browser.
        </p>
      </div>

      <button
        onClick={handleSignOut}
        disabled={signingOut}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-destructive transition-colors hover:bg-accent disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
