"use client";

import { useEffect, useState } from "react";

interface Pack {
  id: string;
  deal_id: string;
  name: string;
  description?: string;
  created_at: string;
}

interface Job {
  id: string;
  attachment_id: string;
  job_type: string;
  status: string;
  created_at: string;
}

interface PackNavigatorCardProps {
  dealId: string;
}

export default function PackNavigatorCard({ dealId }: PackNavigatorCardProps) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showJobs, setShowJobs] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch packs
        const packsRes = await fetch(`/api/deals/${dealId}/packs`);
        if (packsRes.ok) {
          const packsData = await packsRes.json();
          setPacks(packsData.packs || []);
        }

        // Fetch jobs
        const jobsRes = await fetch(`/api/deals/${dealId}/ocr/jobs`);
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          setJobs(jobsData.jobs || []);
        }
      } catch (err) {
        console.error("Error fetching packs/jobs:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [dealId]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-8 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const queuedJobs = jobs.filter((j) => j.status === "queued").length;
  const runningJobs = jobs.filter((j) => j.status === "running").length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3">
        <h3 className="font-semibold text-sm mb-1">Pack Navigator</h3>
        <p className="text-xs text-gray-600">Document organization</p>
      </div>

      {/* Packs List */}
      <div className="space-y-2 mb-4">
        {packs.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No packs created yet</p>
        ) : (
          packs.map((pack) => (
            <div
              key={pack.id}
              className="p-2 rounded border border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer transition-colors"
            >
              <div className="font-medium text-sm">{pack.name}</div>
              {pack.description && (
                <div className="text-xs text-gray-600 mt-0.5">{pack.description}</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Jobs Toggle */}
      <div className="border-t border-gray-200 pt-3">
        <button
          onClick={() => setShowJobs(!showJobs)}
          className="flex items-center justify-between w-full text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          <span>Processing Queue</span>
          <div className="flex items-center gap-2">
            {failedJobs > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                {failedJobs} failed
              </span>
            )}
            {runningJobs > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                {runningJobs} running
              </span>
            )}
            {queuedJobs > 0 && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                {queuedJobs} queued
              </span>
            )}
            <span className="text-gray-400">{showJobs ? "▼" : "▶"}</span>
          </div>
        </button>

        {showJobs && (
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {jobs.length === 0 ? (
              <p className="text-xs text-gray-500 italic">No jobs</p>
            ) : (
              jobs.slice(0, 10).map((job) => (
                <div
                  key={job.id}
                  className={`p-2 rounded text-xs border ${
                    job.status === "failed"
                      ? "border-red-200 bg-red-50"
                      : job.status === "running"
                      ? "border-blue-200 bg-blue-50"
                      : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{job.job_type}</span>
                    <span className="text-gray-600">{job.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
