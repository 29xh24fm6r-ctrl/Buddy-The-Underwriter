import { ReminderHealthCard } from "@/components/ops/ReminderHealthCard";
import { PolicyIngestionCard } from "@/components/ops/PolicyIngestionCard";

export default function OpsPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Operations Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            System health and monitoring
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Reminder System Health */}
        <ReminderHealthCard />

        {/* Policy Ingestion */}
        <PolicyIngestionCard />

        {/* Placeholder for future cards */}
        <div className="col-span-1 border-2 border-dashed border-gray-200 rounded-lg p-12 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <p className="text-sm font-medium">More monitoring cards coming soon</p>
            <p className="text-xs mt-1">Storage health, SBA status, etc.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
