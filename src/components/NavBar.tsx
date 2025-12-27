import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export function NavBar() {
  return (
    <nav className="flex items-center justify-between px-8 py-4 border-b border-gray-200 bg-white">
      <Link href="/" className="font-bold text-lg text-gray-900">
        Buddy the Underwriter
      </Link>

      <div className="flex items-center gap-6">
        <Link href="/pricing" className="text-gray-700 hover:text-gray-900">
          Pricing
        </Link>

        <SignedOut>
          <Link href="/login" className="text-gray-700 hover:text-gray-900">
            Log in
          </Link>
          <Link href="/signup" className="px-4 py-2 rounded bg-black text-white hover:bg-gray-800">
            Get Started
          </Link>
        </SignedOut>

        <SignedIn>
          <Link href="/deals" className="px-4 py-2 rounded border border-gray-300 hover:border-gray-400 text-gray-900">
            Enter App
          </Link>
          <UserButton afterSignOutUrl="/" />
        </SignedIn>
      </div>
    </nav>
  );
}
