import { Routes, Route, Navigate } from "react-router-dom";
import { useAppData } from "./useAppData";
import { AuthProvider, useAuth } from "./auth";
import { NavBar } from "./components/NavBar";
import { FoodList } from "./components/FoodList";
import { FoodForm } from "./components/FoodForm";
import { DailyLog } from "./components/DailyLog";
import { ProfileManager } from "./components/ProfileManager";
import { StorageUsage } from "./components/StorageUsage";
import { AccountPage } from "./components/AccountPage";
import { LoginPage } from "./components/LoginPage";
import { Loader2 } from "lucide-react";

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
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

      <NavBar />
    </div>
  );
}
