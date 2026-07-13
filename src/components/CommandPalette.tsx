import { Fragment } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { normalizeForSearch } from "../search";
import { useOptionListKeyboard } from "../useOptionListKeyboard";
import { useState } from "react";

/** A single actionable command shown in the Cmd+K palette. */
export interface Command {
  id: string;
  title: string;
  /** Grouping header, e.g. "Go to", "Actions". */
  section: string;
  /** Extra terms to match on beyond the title. */
  keywords?: string;
  /** Human-readable shortcut hint, e.g. "1" or "⌘Z". */
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: ReadonlyArray<Command>;
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  const normalizedQuery = normalizeForSearch(query.trim());
  const filtered =
    normalizedQuery.length === 0
      ? commands
      : commands.filter((command) =>
          normalizeForSearch(`${command.title} ${command.keywords ?? ""}`).includes(
            normalizedQuery,
          ),
        );

  function runCommand(command: Command) {
    onOpenChange(false);
    setQuery("");
    command.run();
  }

  const nav = useOptionListKeyboard(filtered, runCommand, normalizedQuery);

  // Reset the query each time the palette is reopened.
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setQuery("");
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>
            Search for an action or a place to go, then press Enter.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={nav.handleKeyDown}
          placeholder="Type a command…"
          autoFocus
        />

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No matching commands.
            </p>
          )}

          {filtered.map((command, index) => {
            const optionProps = nav.getOptionProps(index);
            const previous = filtered[index - 1];
            const showSection =
              previous == null || previous.section !== command.section;
            return (
              <Fragment key={command.id}>
                {showSection && (
                  <p className="px-2 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {command.section}
                  </p>
                )}
                <button
                  type="button"
                  ref={optionProps.ref}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    optionProps.isHighlighted ? "bg-accent" : "hover:bg-accent"
                  }`}
                  onMouseEnter={optionProps.onMouseEnter}
                  onClick={() => runCommand(command)}
                >
                  <span className="truncate">{command.title}</span>
                  {command.hint != null && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {command.hint}
                    </span>
                  )}
                </button>
              </Fragment>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
