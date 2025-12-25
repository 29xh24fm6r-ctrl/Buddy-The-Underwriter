"use client";

/**
 * Borrower Pack Intelligence Card
 * 
 * Shows:
 * - ✅ Selected Pack
 * - 📊 Rank vs alternatives
 * - 🧠 Evidence (avg blockers, sample size, prior overrides)
 * - ⚠ Risk flag (if blockers > threshold)
 * 
 * Actions:
 * - Apply Pack
 * - Override Pack
 * - View Evidence
 * - Re-rank (manual)
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";


import {
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Database,
  RefreshCw,
  ChevronRight,
  Loader2,
} from "lucide-react";


import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";


type PackRanking = {
  pack_template_id: string;
  pack_name: string;
  rank: number;
  score: number;
  avg_blockers: number;
  sample_size: number;
  override_rate: number;
  confidence_level: string;
};

type Props = {
  dealId: string;
  currentPackId?: string | null;
};

export function BorrowerPackIntelligence({ dealId, currentPackId }: Props) {
  const { toast } = useToast();
  const [rankings, setRankings] = useState<PackRanking[]>([]);
  const [selectedPack, setSelectedPack] = useState<PackRanking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [overridePackId, setOverridePackId] = useState<string>("");

  useEffect(() => {
    loadRankings();
  }, [dealId]);

  async function loadRankings() {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/packs/rankings?dealId=${dealId}`);
      if (!response.ok) throw new Error("Failed to load pack rankings");

      const data = await response.json();
      setRankings(data.rankings || []);

      // Select top-ranked pack (rank = 1)
      const topPack = data.rankings?.find((r: PackRanking) => r.rank === 1);
      setSelectedPack(topPack || null);
    } catch (error) {
      console.error("Error loading rankings:", error);
      toast({
        title: "Error",
        description: "Failed to load pack rankings",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleApplyPack() {
    if (!selectedPack) return;

    setIsApplying(true);
    try {
      const response = await fetch("/api/packs/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId }),
      });

      if (!response.ok) throw new Error("Failed to apply pack");

      const result = await response.json();

      toast({
        title: "Pack Applied",
        description: `${result.packName} applied successfully. ${result.requestsCreated} requests created.`,
      });

      // Reload rankings to update state
      await loadRankings();
    } catch (error) {
      console.error("Error applying pack:", error);
      toast({
        title: "Error",
        description: "Failed to apply pack",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }

  async function handleOverridePack() {
    if (!overridePackId) return;

    setIsApplying(true);
    try {
      const response = await fetch("/api/packs/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          toPackId: overridePackId,
          reason: "banker_override",
        }),
      });

      if (!response.ok) throw new Error("Failed to override pack");

      const result = await response.json();

      toast({
        title: "Pack Override Applied",
        description: `${result.requestsCreated} requests created from new pack.`,
      });

      setShowOverrideDialog(false);
      setOverridePackId("");
      await loadRankings();
    } catch (error) {
      console.error("Error overriding pack:", error);
      toast({
        title: "Error",
        description: "Failed to override pack",
        variant: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Borrower Pack Intelligence</CardTitle>
          <CardDescription>AI-powered document pack recommendations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!selectedPack) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Borrower Pack Intelligence</CardTitle>
          <CardDescription>AI-powered document pack recommendations</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No pack recommendations available for this deal.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasRisk = selectedPack.avg_blockers > 2;
  const isHighConfidence = selectedPack.confidence_level === "auto";

  return (
    <Card className="border-l-4 border-l-blue-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Borrower Pack Intelligence</CardTitle>
            <CardDescription>AI-powered document pack recommendations</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={loadRankings} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Selected Pack */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="font-semibold text-lg">{selectedPack.pack_name}</span>
            </div>
            <Badge variant={isHighConfidence ? "default" : "secondary"}>
              Rank #{selectedPack.rank}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Top-ranked pack for this deal
          </p>
        </div>

        {/* Evidence */}
        <div className="grid grid-cols-3 gap-4 py-4 border-y">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{selectedPack.score}</span>
            </div>
            <p className="text-xs text-muted-foreground">Match Score</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              {hasRisk ? (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              <span className={`text-2xl font-bold ${hasRisk ? "text-amber-600" : ""}`}>
                {selectedPack.avg_blockers.toFixed(1)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Avg Blockers</p>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{selectedPack.sample_size}</span>
            </div>
            <p className="text-xs text-muted-foreground">Sample Size</p>
          </div>
        </div>

        {/* Additional Evidence */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Override Rate</span>
            <span className="font-medium">
              {(selectedPack.override_rate * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Confidence Level</span>
            <Badge variant={isHighConfidence ? "default" : "outline"}>
              {selectedPack.confidence_level.toUpperCase()}
            </Badge>
          </div>
        </div>

        {/* Risk Warning */}
        {hasRisk && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">High Blocker Risk</p>
              <p className="text-amber-700">
                This pack historically has {selectedPack.avg_blockers.toFixed(1)} avg blockers.
                Consider reviewing alternatives.
              </p>
            </div>
          </div>
        )}

        {/* Alternatives */}
        {rankings.length > 1 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Alternative Packs ({rankings.length - 1})</p>
            <div className="space-y-1">
              {rankings.slice(1, 4).map((pack) => (
                <div
                  key={pack.pack_template_id}
                  className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                >
                  <span>{pack.pack_name}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      Score: {pack.score}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      Rank #{pack.rank}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleApplyPack}
            disabled={isApplying || !!currentPackId}
            className="flex-1"
          >
            {isApplying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Apply Pack
              </>
            )}
          </Button>

          <Dialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={isApplying}>
                Override
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Override Pack Selection</DialogTitle>
                <DialogDescription>
                  Choose a different pack to apply. This will be logged as a learning event.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <Select value={overridePackId} onValueChange={setOverridePackId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a pack..." />
                  </SelectTrigger>
                  <SelectContent>
                    {rankings.map((pack) => (
                      <SelectItem key={pack.pack_template_id} value={pack.pack_template_id}>
                        {pack.pack_name} (Rank #{pack.rank})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleOverridePack}
                  disabled={!overridePackId || isApplying}
                  className="w-full"
                >
                  {isApplying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Applying Override...
                    </>
                  ) : (
                    "Apply Override"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
