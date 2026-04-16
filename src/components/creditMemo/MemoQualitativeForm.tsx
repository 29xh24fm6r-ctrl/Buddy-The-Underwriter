"use client";

import React from "react";

const fieldStyleLight: React.CSSProperties = { color: "#111827", backgroundColor: "#ffffff" };

const baseLightCls =
  "w-full text-sm border border-gray-300 rounded-md px-3 py-2 " +
  "placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none";

export type QualitativeOverrides = {
  business_description?: string;
  revenue_mix?: string;
  seasonality?: string;
  collateral_description?: string;
  collateral_address?: string;
  competitive_advantages?: string;
  vision?: string;
  [key: string]: string | undefined;
};

type Props = {
  overrides: QualitativeOverrides;
  onChange: (key: string, value: string) => void;
  principals: Array<{ id: string; name: string }>;
  theme?: "dark" | "light";
};

export function MemoQualitativeForm({ overrides, onChange, principals, theme = "light" }: Props) {
  const isDark = theme === "dark";
  const mgmtEntries = principals.length > 0 ? principals : [{ id: "general", name: "Management Team" }];

  const inputCls = isDark
    ? "w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-sky-500/50 resize-none leading-relaxed"
    : baseLightCls;
  const labelCls = isDark ? "block text-xs font-medium text-white/60 mb-1" : "block text-xs font-medium text-gray-700 mb-1";
  const hintCls = isDark ? "text-xs text-white/30 mb-2" : "text-xs text-gray-400 mb-2";
  const headCls = isDark ? "text-xs font-semibold text-white/40 uppercase tracking-widest mb-3" : "text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3";
  const style = isDark ? undefined : fieldStyleLight;

  return (
    <div className="space-y-5">
      <div>
        <div className={headCls}>Business Profile</div>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Business Operations & History</label>
            <p className={hintCls}>Who is the borrower, what do they do, how long have they operated?</p>
            <textarea rows={4} value={overrides.business_description ?? ""} onChange={e => onChange("business_description", e.target.value)}
              placeholder="e.g. Samaritus Management LLC operates Yacht Hampton, a luxury boat charter business founded in 2017 in Sag Harbor, NY..."
              className={inputCls} style={style} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Revenue Mix</label>
              <textarea rows={3} value={overrides.revenue_mix ?? ""} onChange={e => onChange("revenue_mix", e.target.value)}
                placeholder="e.g. 60% boat rentals, 30% corporate events, 10% sailing lessons" className={inputCls} style={style} />
            </div>
            <div>
              <label className={labelCls}>Seasonality</label>
              <textarea rows={3} value={overrides.seasonality ?? ""} onChange={e => onChange("seasonality", e.target.value)}
                placeholder="e.g. Peak May–Sep (85% of revenue)" className={inputCls} style={style} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className={headCls}>Collateral</div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Collateral Description</label>
            <textarea rows={3} value={overrides.collateral_description ?? ""} onChange={e => onChange("collateral_description", e.target.value)}
              placeholder="e.g. 2023 Aquila 36 catamaran maintained at Sag Harbor Marina..." className={inputCls} style={style} />
          </div>
          <div>
            <label className={labelCls}>Collateral Address</label>
            <input type="text" value={overrides.collateral_address ?? ""} onChange={e => onChange("collateral_address", e.target.value)}
              placeholder="e.g. 31 Bay St, Sag Harbor, NY 11963" className={inputCls} style={style} />
          </div>
        </div>
      </div>

      <div>
        <div className={headCls}>Management Qualifications</div>
        <div className="space-y-4">
          {mgmtEntries.map(p => (
            <div key={p.id}>
              <label className={labelCls}>{p.name}</label>
              <textarea rows={4} value={overrides[`principal_bio_${p.id}`] ?? ""}
                onChange={e => onChange(`principal_bio_${p.id}`, e.target.value)}
                placeholder={`Career background, industry experience, track record for ${p.name}...`}
                className={inputCls} style={style} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className={headCls}>Business Strategy</div>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Competitive Advantages</label>
            <textarea rows={3} value={overrides.competitive_advantages ?? ""} onChange={e => onChange("competitive_advantages", e.target.value)}
              placeholder="e.g. Exclusive marina berthing, repeat corporate clientele" className={inputCls} style={style} />
          </div>
          <div>
            <label className={labelCls}>Vision & Growth Strategy</label>
            <textarea rows={3} value={overrides.vision ?? ""} onChange={e => onChange("vision", e.target.value)}
              placeholder="e.g. Expand fleet by 3 vessels, launch electric-only charter tier" className={inputCls} style={style} />
          </div>
        </div>
      </div>
    </div>
  );
}
