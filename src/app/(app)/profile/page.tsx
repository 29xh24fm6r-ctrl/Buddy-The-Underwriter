export const dynamic = "force-dynamic";

import ProfileClient from "./ProfileClient";

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-black/20 to-transparent">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <ProfileClient />
      </div>
    </div>
  );
}
