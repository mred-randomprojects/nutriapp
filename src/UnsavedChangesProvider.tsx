import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { DiscardChangesDialog } from "./components/DiscardChangesDialog";
import {
  UnsavedChangesContext,
  type UnsavedSource,
} from "./unsavedChanges";

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<Record<string, UnsavedSource>>({});
  const sourcesRef = useRef(sources);
  const hasUnsavedChanges = Object.keys(sources).length > 0;

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  const setUnsavedSource = useCallback(
    (id: string, source: UnsavedSource | null) => {
      setSources((prev) => {
        if (source == null) {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }

        return { ...prev, [id]: source };
      });
    },
    [],
  );

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const firstSource = Object.values(sources)[0];

  const discardAllChanges = useCallback(() => {
    for (const source of Object.values(sourcesRef.current)) {
      source.onDiscard?.();
    }
    setSources({});
  }, []);

  const contextValue = useMemo(
    () => ({ hasUnsavedChanges, setUnsavedSource }),
    [hasUnsavedChanges, setUnsavedSource],
  );

  return (
    <UnsavedChangesContext.Provider value={contextValue}>
      {children}
      <DiscardChangesDialog
        open={blocker.state === "blocked"}
        title={firstSource?.title}
        description={firstSource?.description}
        onStay={() => {
          if (blocker.state === "blocked") blocker.reset();
        }}
        onDiscard={() => {
          discardAllChanges();
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </UnsavedChangesContext.Provider>
  );
}
