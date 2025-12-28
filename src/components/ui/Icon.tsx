import * as React from "react";
import {
  CloudUpload,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Trash2,
  Plus,
  Minus,
  RefreshCw,
  FileText,
} from "lucide-react";

export type IconName =
  | "cloud_upload"
  | "chevron_left"
  | "chevron_right"
  | "check_circle"
  | "auto_awesome"
  | "arrow_forward_ios"
  | "delete"
  | "add"
  | "remove"
  | "refresh"
  | "file";

const MAP: Record<IconName, React.ComponentType<{ className?: string }>> = {
  cloud_upload: CloudUpload,
  chevron_left: ChevronLeft,
  chevron_right: ChevronRight,
  check_circle: CheckCircle2,
  auto_awesome: Sparkles,
  arrow_forward_ios: ArrowRight,
  delete: Trash2,
  add: Plus,
  remove: Minus,
  refresh: RefreshCw,
  file: FileText,
};

export function Icon({
  name,
  className,
  title,
}: {
  name: IconName;
  className?: string;
  title?: string;
}) {
  const Cmp = MAP[name];
  return (
    <Cmp
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    />
  );
}
