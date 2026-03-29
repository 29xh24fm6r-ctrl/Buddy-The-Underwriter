"use client";

import {
  calculateSBAGuarantee,
  detectSBAProgram,
} from "@/lib/sba/sbaGuarantee";

interface Props {
  loanAmount: number;
  dealType: string | null;
}

export default function SBAGuaranteeCard({ loanAmount, dealType }: Props) {
  const program = detectSBAProgram(dealType);
  const result = calculateSBAGuarantee(loanAmount, program);
  const is504 = program === "sba_504";

  if (loanAmount <= 0) return null;

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-blue-300 uppercase tracking-wide">
          SBA Guarantee Structure
        </span>
        <span className="text-xs text-blue-400/70">
          {result.programLabel} &middot; {result.sopReference}
        </span>
      </div>

      {/* Main metrics */}
      <div className="grid grid-cols-2 gap-3">
        {/* SBA Guarantee */}
        <div className="rounded-lg border border-blue-500/20 bg-white/[0.03] px-3 py-2">
          <p className="text-xs text-white/50 mb-0.5">
            {is504 ? "CDC Debenture (SBA-backed)" : "SBA Guarantee"}
          </p>
          <p className="text-lg font-bold text-blue-400">
            {is504 ? "Separate" : result.guaranteeAmountFormatted}
          </p>
          {!is504 && (
            <p className="text-xs text-blue-400/70">
              {result.guaranteePctFormatted} of loan
            </p>
          )}
        </div>

        {/* Bank Exposure */}
        <div className="rounded-lg border border-orange-500/20 bg-white/[0.03] px-3 py-2">
          <p className="text-xs text-white/50 mb-0.5">
            {is504 ? "Bank First Mortgage" : "Bank Exposure"}
          </p>
          <p className="text-lg font-bold text-orange-400">
            {result.bankExposureFormatted}
          </p>
          {!is504 && (
            <p className="text-xs text-orange-400/70">
              {result.bankExposurePctFormatted} of loan
            </p>
          )}
        </div>
      </div>

      {/* Visual split bar (only for non-504) */}
      {!is504 && (
        <div className="mt-2">
          <div className="flex w-full h-2 rounded-full overflow-hidden">
            <div
              className="bg-blue-500 h-2"
              style={{ width: result.guaranteePctFormatted }}
              title={`SBA: ${result.guaranteePctFormatted}`}
            />
            <div
              className="bg-orange-400 h-2 flex-1"
              title={`Bank: ${result.bankExposurePctFormatted}`}
            />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-xs text-blue-400/70">
              SBA {result.guaranteePctFormatted}
            </span>
            <span className="text-xs text-orange-400/70">
              Bank {result.bankExposurePctFormatted}
            </span>
          </div>
        </div>
      )}

      {/* Notes */}
      <p className="mt-2 text-xs text-white/40 leading-relaxed">
        {result.notes}
      </p>
    </div>
  );
}
