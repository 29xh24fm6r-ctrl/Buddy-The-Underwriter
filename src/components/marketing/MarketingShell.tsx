import { cn } from "@/lib/cn";

export function Container({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-6xl px-5 sm:px-8",
        className
      )}
      {...props}
    />
  );
}

export function Section({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("py-16 sm:py-24", className)}
      {...props}
    />
  );
}

export function Hairline() {
  return <div className="h-px w-full bg-black/10" />;
}
