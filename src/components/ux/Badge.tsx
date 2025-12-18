export default function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "info";
}) {
  const colors = {
    default: "bg-gray-100 text-gray-800 border-gray-300",
    success: "bg-green-100 text-green-800 border-green-300",
    warning: "bg-amber-100 text-amber-800 border-amber-300",
    info: "bg-blue-100 text-blue-800 border-blue-300",
  };

  return (
    <span
      className={`inline-flex items-center border rounded px-2 py-0.5 text-xs font-medium ${colors[variant]}`}
    >
      {children}
    </span>
  );
}
