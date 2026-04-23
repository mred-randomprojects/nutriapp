import { useLocation, useNavigate } from "react-router-dom";
import { UtensilsCrossed, BookOpen, TrendingUp, Users, CircleUserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/foods", label: "Foods", shortcut: "1", icon: UtensilsCrossed },
  { path: "/log", label: "Log", shortcut: "2", icon: BookOpen },
  { path: "/trend", label: "Trend", shortcut: "3", icon: TrendingUp },
  { path: "/profiles", label: "Profiles", shortcut: "4", icon: Users },
  { path: "/account", label: "Account", shortcut: "5", icon: CircleUserRound },
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
              aria-label={`${item.label} (${item.shortcut})`}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="flex items-baseline gap-1">
                <span>{item.label}</span>
                <span className="text-[10px] leading-none opacity-70">
                  {item.shortcut}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
