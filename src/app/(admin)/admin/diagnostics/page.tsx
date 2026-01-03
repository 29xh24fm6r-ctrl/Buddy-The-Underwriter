import { AdminJobDiagnostics } from "@/components/admin/AdminJobDiagnostics";

export const metadata = {
  title: "Pipeline Diagnostics | Buddy Admin",
  description: "Pipeline health monitoring and diagnostics",
};

/**
 * /admin/diagnostics
 * 
 * Admin-only pipeline diagnostics dashboard.
 * Shows stuck jobs, in-flight operations, and deal health.
 */
export default function AdminDiagnosticsPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Diagnostics</h1>
          <p className="mt-1 text-sm text-gray-600">
            Real-time pipeline health monitoring across all deals
          </p>
        </div>

        <AdminJobDiagnostics />
      </div>
    </div>
  );
}
