import { useLocation, useNavigate } from "react-router-dom";
import { UtensilsCrossed, BookOpen, Users, CircleUserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/foods", label: "Foods", icon: UtensilsCrossed },
  { path: "/log", label: "Log", icon: BookOpen },
  { path: "/profiles", label: "Profiles", icon: Users },
  { path: "/account", label: "Account", icon: CircleUserRound },
] as const;

export function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card">
      <div className="mx-auto flex max-w-lg">
        {NAV_ITEMS.map((item) => {
          const isActive =
            location.pathname === item.path ||
            location.pathname.startsWith(item.path + "/");
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
