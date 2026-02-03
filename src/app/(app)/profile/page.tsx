export const dynamic = "force-dynamic";

import ProfileClient from "./ProfileClient";

export default function ProfilePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-white shadow-sm">
        <ProfileClient />
      </div>
    </div>
  );
}
