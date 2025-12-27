/**
 * Connect Accounts Panel
 * 
 * Borrower-facing UI for connecting accounts:
 * - Plaid (bank accounts)
 * - QuickBooks (accounting)
 * - IRS (tax transcripts)
 * - Payroll systems
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export interface Connection {
  id: string;
  connection_type: string;
  status: "pending" | "active" | "expired" | "revoked" | "error";
  provider_metadata: any;
  last_sync_at?: string;
}

interface ConnectAccountsPanelProps {
  dealId: string;
  connections: Connection[];
  onConnect: (type: string) => void;
  onDisconnect: (connectionId: string) => void;
  readinessBoost: number; // Total % boost from connections
}

const ACCOUNT_TYPES = [
  {
    type: "plaid_bank",
    title: "Bank Accounts",
    description: "Connect your business bank account for instant cash flow analysis",
    timeSaved: "~15 minutes",
    boost: "+15%",
    icon: "🏦",
    benefits: [
      "Skip uploading 12 months of statements",
      "Real-time cash flow tracking",
      "Auto-calculated DSCR",
    ],
  },
  {
    type: "quickbooks_online",
    title: "QuickBooks Online",
    description: "Sync your accounting data automatically",
    timeSaved: "~20 minutes",
    boost: "+20%",
    icon: "📊",
    benefits: [
      "Auto-pull P&L and Balance Sheet",
      "No manual uploads needed",
      "Always up-to-date financials",
    ],
  },
  {
    type: "irs_transcript",
    title: "IRS Tax Transcripts",
    description: "Verify your tax returns directly with the IRS",
    timeSaved: "~10 minutes",
    boost: "+25%",
    icon: "🏛️",
    benefits: [
      "Instant tax return verification",
      "No need to upload past returns",
      "Highest credibility with lenders",
    ],
  },
  {
    type: "gusto",
    title: "Payroll (Gusto/ADP/Paychex)",
    description: "Connect your payroll system",
    timeSaved: "~5 minutes",
    boost: "+5%",
    icon: "💰",
    benefits: [
      "Auto-verify employee count",
      "Confirm payroll expenses",
      "Support cash flow analysis",
    ],
  },
];

export function ConnectAccountsPanel({
  dealId,
  connections,
  onConnect,
  onDisconnect,
  readinessBoost,
}: ConnectAccountsPanelProps) {
  const [expanding, setExpanding] = useState<string | null>(null);

  const isConnected = (type: string) => {
    return connections.some(
      (c) => c.connection_type === type && c.status === "active"
    );
  };

  const getConnection = (type: string) => {
    return connections.find((c) => c.connection_type === type);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-semibold">Want to skip uploads?</h2>
        <p className="text-muted-foreground">
          Connect your accounts instead — it&apos;s faster, more secure, and gives you instant progress.
        </p>

        {/* Readiness Boost Meter */}
        {readinessBoost > 0 && (
          <Card className="bg-green-50 border-green-200">
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <div className="text-3xl font-bold text-green-700">+{readinessBoost}%</div>
                <div className="text-sm text-green-600">Readiness boost from connected accounts</div>
                <Progress value={readinessBoost} className="h-2" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Connection Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {ACCOUNT_TYPES.map((account) => {
          const connected = isConnected(account.type);
          const connection = getConnection(account.type);
          const isExpanded = expanding === account.type;

          return (
            <Card
              key={account.type}
              className={`transition-all ${
                connected
                  ? "border-green-500 bg-green-50"
                  : "hover:border-primary cursor-pointer"
              }`}
              onClick={() => !connected && setExpanding(isExpanded ? null : account.type)}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{account.icon}</span>
                    <div>
                      <CardTitle className="text-lg">{account.title}</CardTitle>
                      <CardDescription>{account.description}</CardDescription>
                    </div>
                  </div>
                  {connected ? (
                    <Badge variant="default" className="bg-green-600">
                      ✓ Connected
                    </Badge>
                  ) : (
                    <Badge variant="secondary">{account.boost}</Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Benefits (collapsed by default) */}
                {isExpanded && !connected && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">What you get:</div>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      {account.benefits.map((benefit, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-green-600">✓</span>
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="pt-2 border-t">
                      <div className="text-xs text-muted-foreground">
                        Time saved: <span className="font-semibold">{account.timeSaved}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Connection Status */}
                {connected && connection && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last synced:</span>
                      <span className="font-medium">
                        {connection.last_sync_at
                          ? new Date(connection.last_sync_at).toLocaleDateString()
                          : "Never"}
                      </span>
                    </div>
                    {connection.provider_metadata?.company_name && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Company:</span>{" "}
                        <span className="font-medium">
                          {connection.provider_metadata.company_name}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Action Button */}
                <div className="pt-2">
                  {connected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (connection) {
                          onDisconnect(connection.id);
                        }
                      }}
                      className="w-full"
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        onConnect(account.type);
                      }}
                      className="w-full"
                    >
                      Connect {account.title}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Security Reassurance */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔒</span>
            <div className="space-y-1">
              <div className="font-semibold text-blue-900">Your data is secure</div>
              <div className="text-sm text-blue-700">
                We use bank-level encryption and never store your login credentials. You can
                disconnect at any time.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
