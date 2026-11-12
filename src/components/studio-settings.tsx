"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  defaultStudioSettings,
  type StudioSettings,
} from "@/lib/types";

type StudioSettingsContextValue = {
  settings: StudioSettings;
  setSettings: (partial: Partial<StudioSettings>) => void;
};

const StudioSettingsContext = createContext<StudioSettingsContextValue | null>(
  null,
);

export function StudioSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<StudioSettings>(
    defaultStudioSettings,
  );

  const setSettings = useCallback((partial: Partial<StudioSettings>) => {
    setSettingsState((current) => ({ ...current, ...partial }));
  }, []);

  const value = useMemo(
    () => ({ settings, setSettings }),
    [settings, setSettings],
  );

  return (
    <StudioSettingsContext.Provider value={value}>
      {children}
    </StudioSettingsContext.Provider>
  );
}

export function useStudioSettings() {
  const value = useContext(StudioSettingsContext);
  if (!value) {
    throw new Error("useStudioSettings must be used within StudioSettingsProvider");
  }
  return value;
}
