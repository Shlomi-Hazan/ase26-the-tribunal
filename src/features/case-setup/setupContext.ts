import { createContext } from "react";
import type { SetupContextValue } from "./setupState";

export const SetupContext = createContext<SetupContextValue | null>(null);
