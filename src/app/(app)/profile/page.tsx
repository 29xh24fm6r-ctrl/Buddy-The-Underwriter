export const dynamic = "force-dynamic";

import ProfileClient from "./ProfileClient";

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-semibold text-white mb-8">Profile</h1>
      <ProfileClient />
    </div>
  );
}
