import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";

export interface UnsavedSource {
  title?: string;
  description?: string;
  onDiscard?: () => void;
}

export interface UnsavedChangesContextValue {
  hasUnsavedChanges: boolean;
  setUnsavedSource: (id: string, source: UnsavedSource | null) => void;
}

interface UseUnsavedChangesOptions {
  title?: string;
  description?: string;
  onDiscard?: () => void;
}

export const UnsavedChangesContext =
  createContext<UnsavedChangesContextValue | null>(null);

export function useUnsavedChanges(
  isDirty: boolean,
  options: UseUnsavedChangesOptions = {},
) {
  const context = useContext(UnsavedChangesContext);
  if (context == null) {
    throw new Error("useUnsavedChanges must be used within UnsavedChangesProvider");
  }

  const { setUnsavedSource } = context;
  const id = useId();
  const onDiscardRef = useRef(options.onDiscard);

  useEffect(() => {
    onDiscardRef.current = options.onDiscard;
  }, [options.onDiscard]);

  const onDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);
  const clearUnsavedChanges = useCallback(
    () => setUnsavedSource(id, null),
    [id, setUnsavedSource],
  );

  useEffect(() => {
    setUnsavedSource(
      id,
      isDirty
        ? {
            title: options.title,
            description: options.description,
            onDiscard,
          }
        : null,
    );

    return clearUnsavedChanges;
  }, [
    clearUnsavedChanges,
    id,
    isDirty,
    onDiscard,
    options.description,
    options.title,
    setUnsavedSource,
  ]);

  return clearUnsavedChanges;
}

export function useHasUnsavedChanges() {
  const context = useContext(UnsavedChangesContext);
  if (context == null) {
    throw new Error("useHasUnsavedChanges must be used within UnsavedChangesProvider");
  }

  return context.hasUnsavedChanges;
}
