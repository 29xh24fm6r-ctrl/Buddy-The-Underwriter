export const dynamic = "force-dynamic";

import ProfileClient from "./ProfileClient";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-6">Profile</h1>
      <ProfileClient />
    </div>
  );
}
