import Link from "next/link";

export function NavBar() {
  return (
    <nav className="flex justify-between items-center px-6 py-4 border-b bg-white">
      <div className="font-bold text-lg">
        Buddy the Underwriter
      </div>
      <div className="flex items-center space-x-4">
        <Link href="/pricing" className="text-gray-700 hover:text-black">
          Pricing
        </Link>
        <Link href="/sign-in" className="text-gray-700 hover:text-black">
          Log in
        </Link>
        <Link
          href="/sign-up"
          className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
        >
          Get Started
        </Link>
      </div>
    </nav>
  );
}
