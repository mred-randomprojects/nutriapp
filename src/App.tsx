import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { useAppData } from "./useAppData";
import { AuthProvider, useAuth } from "./auth";
import { NavBar } from "./components/NavBar";
import { FoodList } from "./components/FoodList";
import { FoodForm } from "./components/FoodForm";
import { DailyLog } from "./components/DailyLog";
import { PlansPage } from "./components/PlansPage";
import { ProfileManager } from "./components/ProfileManager";
import { TrendPage } from "./components/TrendPage";
import { StorageUsage } from "./components/StorageUsage";
import { AccountPage } from "./components/AccountPage";
import { LoginPage } from "./components/LoginPage";
import { Loader2 } from "lucide-react";
import { UnsavedChangesProvider } from "./UnsavedChangesProvider";
import { submitClosestFormFromShortcut } from "./formSubmitShortcut";
import { HistoryPanel } from "./components/HistoryPanel";

const NAV_SHORTCUTS = {
  "1": "/foods",
  "2": "/log",
  "3": "/plans",
  "4": "/trend",
  "5": "/profiles",
  "6": "/account",
} as const;

function todayLogPath(): string {
  return `/log/${format(new Date(), "yyyy-MM-dd")}`;
}

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const { undo, redo, canUndo, canRedo } = appData;

  useEffect(() => {
    window.addEventListener("keydown", submitClosestFormFromShortcut);
    return () =>
      window.removeEventListener("keydown", submitClosestFormFromShortcut);
  }, []);

  useEffect(() => {
    function handleHistoryKeys(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      const key = event.key.toLowerCase();

      // Cmd/Ctrl+K opens the history panel from anywhere.
      if (key === "k" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setHistoryOpen((prev) => !prev);
        return;
      }

      if (key !== "z") return;

      // Leave native text undo/redo alone while editing a field.
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      ) {
        return;
      }

      // Cmd/Ctrl+Shift+Z redoes; Cmd/Ctrl+Z undoes.
      if (event.shiftKey) {
        if (canRedo) {
          event.preventDefault();
          redo();
        }
      } else if (canUndo) {
        event.preventDefault();
        undo();
      }
    }

    window.addEventListener("keydown", handleHistoryKeys);
    return () => window.removeEventListener("keydown", handleHistoryKeys);
  }, [undo, redo, canUndo, canRedo]);

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
      if (
        location.pathname === destination ||
        location.pathname.startsWith(destination + "/")
      ) {
        return;
      }

      event.preventDefault();
      navigate(destination === "/log" ? todayLogPath() : destination);
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [location.pathname, navigate]);

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-20">
      <Routes>
        <Route path="/" element={<Navigate to={todayLogPath()} replace />} />
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
          element={<Navigate to={todayLogPath()} replace />}
        />
        <Route
          path="/log/:date"
          element={<DailyLog appData={appData} />}
        />
        <Route
          path="/plans"
          element={<PlansPage appData={appData} />}
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

      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        undoStack={appData.undoStack}
        redoStack={appData.redoStack}
        canUndo={appData.canUndo}
        canRedo={appData.canRedo}
        onUndo={appData.undo}
        onRedo={appData.redo}
        onUndoTo={appData.undoTo}
      />

      <NavBar />
    </div>
  );
}
