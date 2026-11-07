import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 border border-transparent shadow-card",
  secondary: "bg-white text-ink-800 border border-ink-300 hover:bg-ink-50 hover:border-ink-400",
  ghost: "bg-transparent text-ink-700 border border-transparent hover:bg-ink-100",
  danger: "bg-danger text-white hover:bg-red-800 border border-transparent shadow-card",
};

/** `md` is 44px (touch safe); `sm` drops to 36px from the md breakpoint up, for dense toolbars. */
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-sm",
  sm: "min-h-11 px-3 text-sm md:min-h-9",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  children?: ReactNode;
}

export function Button({ variant = "primary", size = "md", icon: Icon, type = "button", className, children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon aria-hidden="true" size={16} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: LucideIcon;
  /** Required: an icon-only button has no visible text. */
  label: string;
  tone?: "neutral" | "danger" | "success";
}

const TONES = {
  neutral: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger: "text-danger hover:bg-red-50",
  success: "text-success hover:bg-green-50",
};

export function IconButton({ icon: Icon, label, tone = "neutral", type = "button", className, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-11 items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 md:size-9",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  );
}
