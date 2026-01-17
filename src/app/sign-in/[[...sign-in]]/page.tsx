import { SignIn } from "@clerk/nextjs";
import { isValidClerkPublishableKey } from "@/lib/auth/isValidClerkKey";

export default function Page() {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!isValidClerkPublishableKey(pk)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-5 text-center">
          <h1 className="text-lg font-semibold">Sign-in unavailable</h1>
          <p className="mt-2 text-sm text-white/70">
            Authentication is disabled in this environment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  );
}
