import { type ReactNode, useMemo, useReducer } from "react";
import { SetupContext } from "./setupContext";
import { initialSetupState, setupReducer } from "./setupState";

export function SetupProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState);
  const value = useMemo(() => ({ state, dispatch }), [state]);

  return (
    <SetupContext.Provider value={value}>{children}</SetupContext.Provider>
  );
}
