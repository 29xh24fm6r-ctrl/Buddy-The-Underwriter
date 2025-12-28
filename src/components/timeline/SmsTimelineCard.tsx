import * as React from "react";
import type { SmsTimelineItem } from "@/lib/sms/getDealSmsTimeline";
import { MessageSquare, Send, Reply, AlertCircle, CheckCircle } from "lucide-react";

function formatWhen(iso: string) {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    
    return date.toLocaleDateString("en-US", { 
      month: "short", 
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

export function SmsTimelineCard({ items }: { items: SmsTimelineItem[] }) {
  if (!items.length) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-neutral-700" />
        <h3 className="font-semibold text-neutral-900">SMS Activity</h3>
        <span className="ml-auto text-sm text-neutral-500">({items.length})</span>
      </div>

      <div className="space-y-2">
        {items.map((it, idx) => {
          if (it.kind === "sms.outbound") {
            const statusColor = 
              it.status === "sent" ? "text-emerald-700" :
              it.status === "failed" ? "text-red-700" :
              "text-neutral-600";
            
            const StatusIcon = 
              it.status === "sent" ? CheckCircle :
              it.status === "failed" ? AlertCircle :
              Send;

            return (
              <div key={idx} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-neutral-600" />
                    <div className="font-medium text-neutral-900">SMS sent to borrower</div>
                  </div>
                  <div className="text-xs text-neutral-500">{formatWhen(it.createdAt)}</div>
                </div>
                
                <div className="mt-1 text-sm text-neutral-600">To: {it.to}</div>
                
                {it.status && (
                  <div className={`mt-1 flex items-center gap-1 text-sm ${statusColor}`}>
                    <StatusIcon className="h-3 w-3" />
                    <span className="capitalize">{it.status}</span>
                  </div>
                )}
                
                {it.error && (
                  <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-900">
                    Error: {it.error}
                  </div>
                )}
                
                {it.body && (
                  <div className="mt-2 rounded bg-white p-2 text-sm text-neutral-700 whitespace-pre-wrap border border-neutral-200">
                    {it.body}
                  </div>
                )}
              </div>
            );
          }

          if (it.kind === "sms.inbound") {
            return (
              <div key={idx} className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Reply className="h-4 w-4 text-blue-600" />
                    <div className="font-medium text-blue-900">Borrower replied</div>
                  </div>
                  <div className="text-xs text-blue-600">{formatWhen(it.createdAt)}</div>
                </div>
                
                <div className="mt-1 text-sm text-blue-700">From: {it.from}</div>
                
                <div className="mt-2 rounded bg-white p-2 text-sm text-neutral-900 whitespace-pre-wrap border border-blue-200">
                  {it.body}
                </div>
              </div>
            );
          }

          // sms.status
          const hasError = it.errorCode || it.errorMessage;
          const bgColor = hasError ? "bg-red-50 border-red-200" : "bg-neutral-50 border-neutral-200";
          const textColor = hasError ? "text-red-900" : "text-neutral-900";

          return (
            <div key={idx} className={`rounded-lg border p-3 ${bgColor}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className={`h-4 w-4 ${hasError ? "text-red-600" : "text-neutral-600"}`} />
                  <div className={`font-medium ${textColor}`}>SMS delivery update</div>
                </div>
                <div className={`text-xs ${hasError ? "text-red-600" : "text-neutral-500"}`}>
                  {formatWhen(it.createdAt)}
                </div>
              </div>
              
              <div className={`mt-1 text-sm ${hasError ? "text-red-700" : "text-neutral-600"}`}>
                Status: {it.messageStatus ?? "unknown"}
              </div>
              
              {(it.errorCode || it.errorMessage) && (
                <div className="mt-2 rounded bg-red-100 p-2 text-sm text-red-900">
                  Error {it.errorCode ?? ""} {it.errorMessage ?? ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
