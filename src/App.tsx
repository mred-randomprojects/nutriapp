import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAppData } from "./useAppData";
import { AuthProvider, useAuth } from "./auth";
import { NavBar } from "./components/NavBar";
import { FoodList } from "./components/FoodList";
import { FoodForm } from "./components/FoodForm";
import { DailyLog } from "./components/DailyLog";
import { ProfileManager } from "./components/ProfileManager";
import { TrendPage } from "./components/TrendPage";
import { StorageUsage } from "./components/StorageUsage";
import { AccountPage } from "./components/AccountPage";
import { LoginPage } from "./components/LoginPage";
import { CloudUpload, Loader2 } from "lucide-react";
import { UnsavedChangesProvider } from "./UnsavedChangesProvider";

const NAV_SHORTCUTS = {
  "1": "/foods",
  "2": "/log",
  "3": "/trend",
  "4": "/profiles",
  "5": "/account",
} as const;

export default function App() {
  return (
    <AuthProvider>
      <UnsavedChangesProvider>
        <AuthGate />
      </UnsavedChangesProvider>
    </AuthProvider>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user == null) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  const appData = useAppData();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement)
      ) {
        return;
      }

      if (!(event.key in NAV_SHORTCUTS)) {
        return;
      }

      const destination =
        NAV_SHORTCUTS[event.key as keyof typeof NAV_SHORTCUTS];
      if (location.pathname === destination) {
        return;
      }

      event.preventDefault();
      navigate(destination);
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [location.pathname, navigate]);

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-20">
      <Routes>
        <Route path="/" element={<Navigate to="/log" replace />} />
        <Route
          path="/foods"
          element={<FoodList appData={appData} />}
        />
        <Route
          path="/foods/new"
          element={<FoodForm appData={appData} />}
        />
        <Route
          path="/foods/:foodId/edit"
          element={<FoodForm appData={appData} />}
        />
        <Route
          path="/log"
          element={<DailyLog appData={appData} />}
        />
        <Route
          path="/trend"
          element={<TrendPage appData={appData} />}
        />
        <Route
          path="/profiles"
          element={<ProfileManager appData={appData} />}
        />
        <Route path="/account" element={<AccountPage />} />
      </Routes>

      {appData.storageError != null && (
        <div className="fixed left-0 right-0 top-0 z-50 bg-destructive p-3 text-center text-sm text-destructive-foreground">
          {appData.storageError}
          <button
            className="ml-2 underline"
            onClick={() => appData.setStorageError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="fixed bottom-16 left-1/2 w-full max-w-lg -translate-x-1/2 px-4">
        <StorageUsage />
      </div>

      <button
        onClick={appData.forceCloudSync}
        disabled={appData.cloudSyncing}
        className="fixed bottom-20 right-3 z-40 flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg active:scale-95 disabled:opacity-50"
      >
        {appData.cloudSyncing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CloudUpload className="h-3.5 w-3.5" />
        )}
        Sync to Cloud
      </button>

      <NavBar />
    </div>
  );
}
