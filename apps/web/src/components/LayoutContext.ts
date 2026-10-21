import type { PayrollSettings } from "../api/settings";

export interface LayoutContext {
  onPayrollSettingsChanged: (settings: PayrollSettings) => void;
}
