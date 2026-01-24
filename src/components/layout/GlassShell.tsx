import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * GlassShell - Canonical layout wrapper for non-Stitch pages.
 *
 * Provides:
 * - Dark background gradient
 * - Centered max-width container
 * - Consistent spacing below nav
 * - Glass panel styling via children
 */
export function GlassShell({
  children,
  className,
  maxWidth = "7xl",
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  maxWidth?: "5xl" | "6xl" | "7xl" | "full";
  padding?: boolean;
}) {
  const maxWidthClass = {
    "5xl": "max-w-5xl",
    "6xl": "max-w-6xl",
    "7xl": "max-w-7xl",
    full: "max-w-full",
  }[maxWidth];

  return (
    <div className={cn("min-h-screen bg-[#0b0f1a] text-white", className)}>
      <div
        className={cn(
          "mx-auto w-full",
          maxWidthClass,
          padding && "px-6 py-6"
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * GlassPageHeader - Canonical page header with title and actions.
 */
export function GlassPageHeader({
  title,
  subtitle,
  badge,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "rounded-2xl border border-white/10 bg-[#0f172a]/80 backdrop-blur-sm px-6 py-6 mb-6",
        className
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">{title}</h1>
            {badge}
          </div>
          {subtitle && (
            <p className="text-sm text-white/60">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * GlassPanel - Glass-styled container for content sections.
 */
export function GlassPanel({
  children,
  header,
  headerAction,
  className,
  noPadding,
}: {
  children: ReactNode;
  header?: string;
  headerAction?: ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm shadow-[0_8px_32px_rgba(0,0,0,0.12)] overflow-hidden",
        className
      )}
    >
      {header && (
        <div className="border-b border-white/10 bg-white/[0.02] px-5 py-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">
            {header}
          </span>
          {headerAction}
        </div>
      )}
      <div className={cn(!noPadding && "p-4")}>{children}</div>
    </div>
  );
}

/**
 * GlassTable - Glass-styled table wrapper.
 */
export function GlassTable({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden",
        className
      )}
    >
      <table className="w-full">{children}</table>
    </div>
  );
}

/**
 * GlassTableHeader - Glass-styled table header.
 */
export function GlassTableHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <thead className={cn("bg-white/[0.02] border-b border-white/10", className)}>
      {children}
    </thead>
  );
}

/**
 * GlassTableHeaderCell - Glass-styled table header cell.
 */
export function GlassTableHeaderCell({
  children,
  className,
  align = "left",
}: {
  children: ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <th
      className={cn(
        "px-6 py-3 text-[11px] font-semibold text-white/70 uppercase tracking-wider",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className
      )}
    >
      {children}
    </th>
  );
}

/**
 * GlassTableBody - Glass-styled table body.
 */
export function GlassTableBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tbody className={cn("divide-y divide-white/5", className)}>{children}</tbody>
  );
}

/**
 * GlassTableRow - Glass-styled table row with hover state.
 */
export function GlassTableRow({
  children,
  className,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <tr
      className={cn(
        "hover:bg-white/[0.02] transition-colors",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

/**
 * GlassTableCell - Glass-styled table cell.
 */
export function GlassTableCell({
  children,
  className,
  align = "left",
}: {
  children: ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <td
      className={cn(
        "px-6 py-4 text-sm text-white/80",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className
      )}
    >
      {children}
    </td>
  );
}

/**
 * GlassEmptyState - Empty state placeholder for glass tables/panels.
 */
export function GlassEmptyState({
  icon = "folder_open",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-12">
      <span className="material-symbols-outlined text-white/20 text-6xl">
        {icon}
      </span>
      <p className="text-white/60 mt-4">{title}</p>
      {description && <div className="text-white/40 mt-2 text-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * GlassStatCard - Stat card for metrics/KPIs.
 */
export function GlassStatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/10 bg-white/[0.03] p-4",
        className
      )}
    >
      <div className="text-sm text-white/60 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

/**
 * GlassInfoBox - Info/tip box with icon.
 */
export function GlassInfoBox({
  icon = "info",
  title,
  children,
  variant = "info",
  className,
}: {
  icon?: string;
  title?: string;
  children: ReactNode;
  variant?: "info" | "warning" | "success" | "error";
  className?: string;
}) {
  const variantStyles = {
    info: "bg-primary/10 border-primary/30 text-primary",
    warning: "bg-amber-500/10 border-amber-500/30 text-amber-500",
    success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-500",
    error: "bg-red-500/10 border-red-500/30 text-red-500",
  }[variant];

  return (
    <div
      className={cn(
        "p-4 border rounded-lg",
        variantStyles,
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "material-symbols-outlined text-[20px] mt-0.5",
            variant === "info" && "text-primary",
            variant === "warning" && "text-amber-500",
            variant === "success" && "text-emerald-500",
            variant === "error" && "text-red-500"
          )}
        >
          {icon}
        </span>
        <div>
          {title && (
            <div className="text-sm font-semibold text-white mb-1">{title}</div>
          )}
          <div className="text-sm text-white/70">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * GlassActionCard - Card with icon, title, description, and action link.
 */
export function GlassActionCard({
  icon,
  iconColor = "text-primary",
  title,
  description,
  href,
  actionLabel = "View",
  disabled,
  disabledLabel,
  className,
}: {
  icon: string;
  iconColor?: string;
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
  disabled?: boolean;
  disabledLabel?: string;
  className?: string;
}) {
  const Wrapper = href && !disabled ? "a" : "div";
  const wrapperProps = href && !disabled ? { href } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        "block p-6 rounded-2xl border border-white/10 bg-white/[0.03] transition-all group",
        !disabled && href && "hover:border-primary/50 hover:bg-white/[0.05]",
        disabled && "opacity-60",
        className
      )}
    >
      <span className={cn("material-symbols-outlined text-4xl mb-3 block", iconColor)}>
        {icon}
      </span>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-white/60">{description}</p>
      <div className="mt-4">
        {disabled ? (
          <span className="text-white/40 text-sm font-medium">
            {disabledLabel || "Coming Soon"}
          </span>
        ) : href ? (
          <span className="text-primary text-sm font-medium inline-flex items-center gap-1 group-hover:gap-2 transition-all">
            {actionLabel}
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </span>
        ) : null}
      </div>
    </Wrapper>
  );
}
