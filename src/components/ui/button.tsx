import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
type Size = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild, ...props }, ref) => {
    const v =
      variant === "ghost" ? "bg-transparent hover:bg-white/5" :
      variant === "outline" ? "border border-white/10 bg-transparent hover:bg-white/5" :
      variant === "secondary" ? "bg-white/10 hover:bg-white/15" :
      variant === "destructive" ? "bg-red-600/80 hover:bg-red-600" :
      variant === "link" ? "bg-transparent underline-offset-4 hover:underline" :
      "bg-white/10 hover:bg-white/15";

    const s =
      size === "icon" ? "h-9 w-9 p-0" :
      size === "sm" ? "h-8 px-3 text-sm" :
      size === "lg" ? "h-11 px-6" :
      "h-10 px-4";

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none",
          v,
          s,
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
