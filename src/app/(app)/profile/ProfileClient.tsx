"use client";

import { useState, useEffect, useRef } from "react";

type Profile = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

type Membership = {
  bank_id: string;
  bank_name: string;
  role: string;
};

type CurrentBank = {
  id: string;
  name: string;
};

// Input styling constants
const INPUT_CLS =
  "w-full rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-white " +
  "placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20";
const DISABLED_INPUT_CLS = `${INPUT_CLS} disabled:opacity-50 disabled:cursor-not-allowed`;

export default function ProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaMismatch, setSchemaMismatch] = useState(false);

  // Additional context from API
  const [email, setEmail] = useState<string | null>(null);
  const [currentBankRole, setCurrentBankRole] = useState<string | null>(null);

  // Bank context
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentBank, setCurrentBank] = useState<CurrentBank | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [switchingBank, setSwitchingBank] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create bank form
  const [showCreateBank, setShowCreateBank] = useState(false);
  const [newBankName, setNewBankName] = useState("");
  const [creatingBank, setCreatingBank] = useState(false);

  // Diagnostics state
  const [copied, setCopied] = useState(false);
  const [showFullDiagnostics, setShowFullDiagnostics] = useState(false);

  // Dirty tracking: last-saved values
  const [savedDisplayName, setSavedDisplayName] = useState("");
  const [savedAvatarUrl, setSavedAvatarUrl] = useState("");

  const isDirty =
    displayName !== savedDisplayName || avatarUrl !== savedAvatarUrl;

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((json) => {
        if (json.memberships) setMemberships(json.memberships);
        if (json.current_bank) setCurrentBank(json.current_bank);
        if (json.email) setEmail(json.email);
        if (json.current_bank_role) setCurrentBankRole(json.current_bank_role);

        if (json.ok && json.profile) {
          setProfile(json.profile);
          const dn = json.profile.display_name ?? "";
          const au = json.profile.avatar_url ?? "";
          setDisplayName(dn);
          setAvatarUrl(au);
          setSavedDisplayName(dn);
          setSavedAvatarUrl(au);
        } else if (json.error === "schema_mismatch") {
          setSchemaMismatch(true);
          if (json.profile) setProfile(json.profile);
        } else {
          setError(json.error ?? "Failed to load profile");
        }
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          avatar_url: avatarUrl.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.ok && json.profile) {
        const dn = json.profile.display_name ?? "";
        const au = json.profile.avatar_url ?? "";
        setProfile(json.profile);
        setDisplayName(dn);
        setAvatarUrl(au);
        setSavedDisplayName(dn);
        setSavedAvatarUrl(au);
        setSaveMsg("Saved");
        window.dispatchEvent(new Event("profile-updated"));
      } else {
        setSaveMsg(json.error ?? "Save failed");
      }
    } catch {
      setSaveMsg("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleFileUpload(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleBankSwitch(bankId: string) {
    if (bankId === currentBank?.id) return;
    setSwitchingBank(true);
    try {
      const res = await fetch("/api/profile/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bank_id: bankId }),
      });
      const json = await res.json();
      if (json.ok) {
        window.location.reload();
      } else {
        setSaveMsg(json.error ?? "Bank switch failed");
        setSwitchingBank(false);
      }
    } catch {
      setSaveMsg("Network error");
      setSwitchingBank(false);
    }
  }

  async function handleCreateBank() {
    if (!newBankName.trim()) return;
    setCreatingBank(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/banks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newBankName.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        window.location.reload();
      } else {
        setSaveMsg(json.error ?? "Bank creation failed");
      }
    } catch {
      setSaveMsg("Network error");
    } finally {
      setCreatingBank(false);
    }
  }

  function handleCopyDiagnostics() {
    const diagnostics = {
      url: typeof window !== "undefined" ? window.location.href : "",
      build: {
        sha: process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown",
        env: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
        time: process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown",
      },
      user: {
        clerkUserId: profile?.clerk_user_id ?? "unknown",
        email: email ?? "unknown",
        profileId: profile?.id ?? "unknown",
      },
      bank: {
        id: currentBank?.id ?? "none",
        name: currentBank?.name ?? "none",
        role: currentBankRole ?? "none",
      },
    };

    navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)).then(() => {
      setCopied(true);
      console.log("[profile] diagnostics_copied");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-white">
        <div className="text-white/60 text-sm">Loading profile...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-white">
        <div className="text-rose-400 text-sm">{error}</div>
      </div>
    );
  }

  const initials = (displayName || profile?.clerk_user_id || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const buildSha = process.env.NEXT_PUBLIC_GIT_SHA?.slice(0, 7) ?? "dev";

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-white shadow-sm">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-white/60">
            Update your identity and confirm your bank context.
          </p>
        </div>
      </header>

      {schemaMismatch && (
        <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <strong>Profile schema pending migration.</strong>{" "}
          Run migration <code className="text-amber-300">20260202_profiles_avatar.sql</code> in Supabase.
        </div>
      )}

      {/* Two-column layout */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Identity + Bank Context */}
        <div className="lg:col-span-2 space-y-6">
          {/* Identity Card */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase">Identity</h2>
                <p className="mt-1 text-sm text-white/60">Your display name and avatar.</p>
              </div>
              <div className="flex items-center gap-3">
                {saveMsg && (
                  <span
                    className={`text-sm font-medium ${
                      saveMsg === "Saved" ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {saveMsg === "Saved" && "✓ "}
                    {saveMsg}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                    saving
                      ? "bg-white/60 text-black/70 cursor-wait"
                      : isDirty
                        ? "bg-white text-black hover:bg-white/90 active:scale-[0.97] shadow-md"
                        : "border border-white/15 text-white/30 cursor-not-allowed"
                  }`}
                >
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              {/* Avatar row */}
              <div className="flex items-center gap-4">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="h-16 w-16 rounded-full object-cover border-2 border-white/20 shadow-lg"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/20 border-2 border-white/20 text-lg font-bold text-white shadow-lg">
                    {initials}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                  >
                    Upload avatar
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl("")}
                      className="text-xs text-white/40 hover:text-white/70 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Display name */}
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1.5">
                  Display name
                </label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className={INPUT_CLS}
                />
              </div>

              {/* Avatar URL (manual) */}
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1.5">
                  Avatar URL
                </label>
                <input
                  value={avatarUrl.startsWith("data:") ? "(uploaded file)" : avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://..."
                  disabled={avatarUrl.startsWith("data:")}
                  className={DISABLED_INPUT_CLS}
                />
              </div>

              {/* Email (read-only) */}
              <div>
                <label className="block text-sm font-medium text-white/90 mb-1.5">
                  Email
                </label>
                <input
                  value={email ?? "Not available"}
                  disabled
                  className={DISABLED_INPUT_CLS}
                />
                <p className="mt-1 text-xs text-white/50">Managed by Clerk authentication.</p>
              </div>
            </div>
          </section>

          {/* Bank Context Card */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase">Bank Context</h2>
            <p className="mt-1 text-sm text-white/60">
              Bank-scoped docs and deal tenancy use your active bank.
            </p>

            <div className="mt-5 space-y-4">
              {/* Active bank info */}
              {currentBank ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div>
                    <span className="text-white/50">Bank:</span>{" "}
                    <span className="font-medium text-white">{currentBank.name}</span>
                  </div>
                  <div>
                    <span className="text-white/50">ID:</span>{" "}
                    <span className="font-mono text-xs text-white/70">{currentBank.id.slice(0, 8)}...</span>
                  </div>
                  {currentBankRole && (
                    <div>
                      <span className="text-white/50">Role:</span>{" "}
                      <span className="inline-flex items-center rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-white/80">
                        {currentBankRole}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                  No bank configured. Create one to start working with deals and documents.
                </div>
              )}

              {/* Bank switcher (if multiple memberships) */}
              {memberships.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-1.5">
                    Switch Bank
                  </label>
                  <select
                    value={currentBank?.id ?? ""}
                    onChange={(e) => handleBankSwitch(e.target.value)}
                    disabled={switchingBank}
                    className={DISABLED_INPUT_CLS}
                  >
                    {!currentBank && <option value="">Select a bank...</option>}
                    {memberships.map((m) => (
                      <option key={m.bank_id} value={m.bank_id}>
                        {m.bank_name} ({m.role})
                      </option>
                    ))}
                  </select>
                  {switchingBank && (
                    <div className="mt-1 text-xs text-white/50">Switching bank...</div>
                  )}
                </div>
              )}

              {/* Divider */}
              <div className="h-px bg-white/10" />

              {/* Create Bank */}
              {showCreateBank ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium text-white/80">Create a New Bank</div>
                  <div>
                    <label className="block text-sm font-medium text-white/90 mb-1.5">
                      Bank Name
                    </label>
                    <input
                      value={newBankName}
                      onChange={(e) => setNewBankName(e.target.value)}
                      placeholder="e.g. Paller Bank"
                      className={INPUT_CLS}
                    />
                  </div>
                  <p className="text-xs text-white/50">
                    Creates a new bank and sets it as your active bank.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCreateBank}
                      disabled={creatingBank || !newBankName.trim()}
                      className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
                        creatingBank
                          ? "bg-white/60 text-black/70 cursor-wait"
                          : newBankName.trim()
                            ? "bg-white text-black hover:bg-white/90 active:scale-[0.97] shadow-md"
                            : "border border-white/15 text-white/30 cursor-not-allowed"
                      }`}
                    >
                      {creatingBank ? "Creating..." : "Create & Switch"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateBank(false)}
                      className="text-sm text-white/50 hover:text-white/80 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreateBank(true)}
                  className="text-sm font-medium text-white/70 hover:text-white transition-colors"
                >
                  + Create new bank
                </button>
              )}
            </div>
          </section>
        </div>

        {/* Right column: Diagnostics */}
        <div className="lg:col-span-1">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-white/90 uppercase">Diagnostics</h2>
              <button
                type="button"
                onClick={handleCopyDiagnostics}
                className="text-xs font-medium text-white/60 hover:text-white transition-colors border border-white/10 rounded-lg px-2.5 py-1 hover:bg-white/5"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* Key info always visible */}
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/50">Build</span>
                <span className="font-mono text-xs text-white/70">{buildSha}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Bank ID</span>
                <span className="font-mono text-xs text-white/70">
                  {currentBank?.id?.slice(0, 8) ?? "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">User ID</span>
                <span className="font-mono text-xs text-white/70">
                  {profile?.clerk_user_id?.slice(0, 12) ?? "—"}
                </span>
              </div>
            </div>

            {/* Toggle for full details */}
            <button
              type="button"
              onClick={() => setShowFullDiagnostics(!showFullDiagnostics)}
              className="mt-3 text-xs text-white/50 hover:text-white/70 transition-colors flex items-center gap-1"
            >
              <svg
                className={`h-3 w-3 transition-transform ${showFullDiagnostics ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {showFullDiagnostics ? "Hide details" : "Show more"}
            </button>

            {/* Full diagnostics (collapsible) */}
            {showFullDiagnostics && (
              <div className="mt-3 pt-3 border-t border-white/10 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/50">Profile ID</span>
                  <span className="font-mono text-xs text-white/70">
                    {profile?.id?.slice(0, 8) ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Email</span>
                  <span className="text-xs text-white/70 truncate max-w-[120px]">
                    {email ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Bank Name</span>
                  <span className="text-xs text-white/70 truncate max-w-[120px]">
                    {currentBank?.name ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/50">Role</span>
                  <span className="text-xs text-white/70">{currentBankRole ?? "—"}</span>
                </div>
                {process.env.NEXT_PUBLIC_VERCEL_ENV && (
                  <div className="flex justify-between">
                    <span className="text-white/50">Env</span>
                    <span className="text-xs text-white/70">{process.env.NEXT_PUBLIC_VERCEL_ENV}</span>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
