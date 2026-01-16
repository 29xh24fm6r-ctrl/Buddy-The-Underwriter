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
  File,
  RotateCw,
  AlertCircle,
  CheckSquare,
  ListChecks,
  History,
  Clock,
  Calendar,
  Rocket,
  Play,
  Pencil,
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
  | "file"
  | "description"
  | "edit"
  | "sync"
  | "error"
  | "fact_check"
  | "checklist"
  | "history"
  | "pending"
  | "event"
  | "rocket_launch"
  | "play_arrow";

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
  description: File,
  edit: Pencil,
  sync: RotateCw,
  error: AlertCircle,
  fact_check: CheckSquare,
  checklist: ListChecks,
  history: History,
  pending: Clock,
  event: Calendar,
  rocket_launch: Rocket,
  play_arrow: Play,
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
    />
  );
}
