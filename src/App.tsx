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
import { PlanEditor } from "./components/PlanEditor";
import { ProfileManager } from "./components/ProfileManager";
import { TrendPage } from "./components/TrendPage";
import { StorageUsage } from "./components/StorageUsage";
import { AccountPage } from "./components/AccountPage";
import { downloadBackup } from "./downloadBackup";
import { LoginPage } from "./components/LoginPage";
import { Loader2 } from "lucide-react";
import { UnsavedChangesProvider } from "./UnsavedChangesProvider";
import { useKeyboardFocusParity } from "./useKeyboardFocusParity";
import {
  isEditableShortcutTarget,
  isInsideModalLayer,
} from "./shortcutTargets";
import { submitClosestForm, submitClosestFormFromShortcut } from "./formSubmitShortcut";
import { interceptSave } from "cmd-s";
import { SaveIndicator } from "./components/SaveIndicator";
import { HistoryPanel } from "./components/HistoryPanel";
import { CommandPalette } from "./components/CommandPalette";
import type { Command } from "./components/CommandPalette";

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

  // Above the auth gate: the login page is a form and a button too, and WebKit
  // skips its button in the tab order just the same.
  useKeyboardFocusParity();

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { undo, redo, canUndo, canRedo } = appData;

  const commands: Command[] = [
    { id: "nav-foods", title: "Go to Foods", section: "Go to", keywords: "food list", hint: "1", run: () => navigate("/foods") },
    { id: "nav-log", title: "Go to Log", section: "Go to", keywords: "daily log today", hint: "2", run: () => navigate(todayLogPath()) },
    { id: "nav-plans", title: "Go to Plans", section: "Go to", keywords: "meal plans", hint: "3", run: () => navigate("/plans") },
    { id: "nav-trend", title: "Go to Trend", section: "Go to", keywords: "weight chart graph", hint: "4", run: () => navigate("/trend") },
    { id: "nav-profiles", title: "Go to Profiles", section: "Go to", keywords: "books switch", hint: "5", run: () => navigate("/profiles") },
    { id: "nav-account", title: "Go to Account", section: "Go to", keywords: "settings sign out", hint: "6", run: () => navigate("/account") },
    { id: "act-today", title: "Jump to today", section: "Actions", keywords: "log date now", run: () => navigate(todayLogPath()) },
    { id: "act-add-food", title: "Add a new food", section: "Actions", keywords: "create new food", run: () => navigate("/foods/new") },
    { id: "act-history", title: "Open change history", section: "Actions", keywords: "undo timeline redo", run: () => setHistoryOpen(true) },
    { id: "act-backup", title: "Download backup (JSON)", section: "Actions", keywords: "export save file json", run: () => downloadBackup(appData.data) },
    ...(canUndo ? [{ id: "act-undo", title: "Undo last change", section: "Actions", keywords: "revert", hint: "⌘Z", run: undo }] : []),
    ...(canRedo ? [{ id: "act-redo", title: "Redo change", section: "Actions", keywords: "", hint: "⇧⌘Z", run: redo }] : []),
  ];

  useEffect(() => {
    window.addEventListener("keydown", submitClosestFormFromShortcut);
    return () =>
      window.removeEventListener("keydown", submitClosestFormFromShortcut);
  }, []);

  // ⌘S / Ctrl+S, instead of the browser's "Save page" dialog. Inside a form it
  // is that form's own save, same as ⌘Enter. Anywhere else there is nothing
  // left to write — every change already wrote itself — so it only confirms,
  // or repeats the storage error if the last write did not land, and never
  // says a plain "Saved" while the cloud copy is failing. Top of the screen:
  // the nav bar owns the bottom.
  const { storageError, cloudError } = appData;
  useEffect(
    () =>
      interceptSave({
        position: "top",
        onSave: () => {
          if (submitClosestForm(document.activeElement)) return;
          return (
            storageError ??
            (cloudError != null
              ? "Saved on this device — cloud sync failed"
              : "Saved")
          );
        },
      }),
    [storageError, cloudError],
  );

  useEffect(() => {
    function handleHistoryKeys(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      const key = event.key.toLowerCase();

      // Cmd/Ctrl+K opens the command palette from anywhere.
      if (key === "k" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
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

      // Let people type, and let the top-most layer keep its keys: with the
      // palette open, `1` is for filtering it, not for leaving the page behind
      // it.
      if (
        isEditableShortcutTarget(event.target) ||
        isInsideModalLayer(event.target)
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
          path="/plans/:planId/edit"
          element={<PlanEditor appData={appData} />}
        />
        <Route
          path="/trend"
          element={<TrendPage appData={appData} />}
        />
        <Route
          path="/profiles"
          element={<ProfileManager appData={appData} />}
        />
        <Route path="/account" element={<AccountPage appData={appData} />} />
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
        {appData.cloudError == null && (
          <SaveIndicator status={appData.saveStatus} />
        )}
        {appData.cloudError != null && (
          <div className="mb-2 flex justify-center">
            <p
              role="status"
              className="rounded-full bg-destructive px-3 py-1 text-xs text-destructive-foreground"
            >
              {appData.cloudError}
            </p>
          </div>
        )}
        <StorageUsage />
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
      />

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
