"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ReminderStats = {
  ok: boolean;
  timestamp: string;
  subscriptions: {
    total_active: number;
    due_now: number;
    due_next_24h: number;
  };
  runs_last_24h: {
    total: number;
    sent: number;
    skipped: number;
    error: number;
    error_rate_pct: number;
  };
  runs_last_7d: {
    total: number;
    error: number;
    error_rate_pct: number;
  };
  health: "healthy" | "degraded" | "critical";
};

export function ReminderHealthCard() {
  const [stats, setStats] = useState<ReminderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/reminders/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      setStats(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const healthStyles = {
    healthy: "bg-green-50 border-green-200",
    degraded: "bg-yellow-50 border-yellow-200",
    critical: "bg-red-50 border-red-200",
  };

  const healthBadgeStyles = {
    healthy: "bg-green-100 text-green-800",
    degraded: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
  };

  if (loading && !stats) {
    return (
      <div className="border rounded-lg p-6">
        <div className="flex items-center gap-2">
          <div className="animate-spin h-5 w-5 border-2 border-gray-300 border-t-gray-600 rounded-full" />
          <h3 className="text-lg font-semibold">Loading Reminder Health...</h3>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-200 rounded-lg p-6 bg-red-50">
        <h3 className="text-lg font-semibold text-red-800 mb-2">Reminder Health - Error</h3>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className={`border rounded-lg p-6 ${healthStyles[stats.health]}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Reminder System</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${healthBadgeStyles[stats.health]}`}>
          {stats.health.toUpperCase()}
        </span>
      </div>

      {/* Active Subscriptions */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-xs text-gray-600 mb-1">Active</p>
          <p className="text-2xl font-bold">{stats.subscriptions.total_active}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">Due Now</p>
          <p className="text-2xl font-bold">{stats.subscriptions.due_now}</p>
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">Next 24h</p>
          <p className="text-2xl font-bold">{stats.subscriptions.due_next_24h}</p>
        </div>
      </div>

      {/* Runs Last 24h */}
      <div className="border-t pt-4 mb-4">
        <p className="text-xs font-semibold text-gray-700 mb-3">Last 24 Hours</p>
        <div className="grid grid-cols-4 gap-3 text-xs mb-3">
          <div>
            <p className="text-gray-600">Total</p>
            <p className="font-mono font-bold">{stats.runs_last_24h.total}</p>
          </div>
          <div>
            <p className="text-gray-600">Sent</p>
            <p className="font-mono font-bold text-green-700">{stats.runs_last_24h.sent}</p>
          </div>
          <div>
            <p className="text-gray-600">Skipped</p>
            <p className="font-mono font-bold text-gray-600">{stats.runs_last_24h.skipped}</p>
          </div>
          <div>
            <p className="text-gray-600">Errors</p>
            <p className="font-mono font-bold text-red-700">{stats.runs_last_24h.error}</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Error Rate (24h)</span>
          <span className="font-mono font-bold">
            {stats.runs_last_24h.error_rate_pct.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Runs Last 7d */}
      <div className="border-t pt-4 mb-4">
        <p className="text-xs font-semibold text-gray-700 mb-3">Last 7 Days</p>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Total Runs</span>
            <span className="font-mono font-bold">{stats.runs_last_7d.total}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Errors</span>
            <span className="font-mono font-bold text-red-700">{stats.runs_last_7d.error}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Error Rate (7d)</span>
            <span className="font-mono font-bold">
              {stats.runs_last_7d.error_rate_pct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* War Room Mode Selection */}
      <div className="border-t pt-4 mb-3">
        <p className="text-xs font-semibold text-gray-700 mb-3">War Room</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/ops/reminders/war-room?mode=tail"
            className="px-3 py-2 rounded-xl text-xs font-semibold border bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            Open War Room
          </Link>

          <Link
            href="/ops/reminders/war-room?mode=grafana"
            className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 transition-colors"
          >
            Grafana-lite
          </Link>

          <Link
            href="/ops/reminders/war-room?mode=movie"
            className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 bg-white text-slate-900 hover:bg-slate-50 transition-colors"
          >
            Movie UI
          </Link>
        </div>
      </div>

      {/* Last Updated */}
      <div className="border-t pt-3 text-xs text-gray-500">
        Last updated: {new Date(stats.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
