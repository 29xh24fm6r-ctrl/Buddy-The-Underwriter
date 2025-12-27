import Link from "next/link";

export function Footer() {
  return (
    <footer className="py-12 px-6 bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-8">
        <div>
          <h4 className="font-bold mb-4">Buddy</h4>
          <p className="text-gray-400 text-sm">
            SBA underwriting software for modern lenders.
          </p>
        </div>
        <div>
          <h4 className="font-semibold mb-4">Product</h4>
          <ul className="space-y-2 text-sm">
            <li><Link href="/pricing" className="text-gray-400 hover:text-white">Pricing</Link></li>
            <li><Link href="/sign-up" className="text-gray-400 hover:text-white">Sign Up</Link></li>
            <li><Link href="/sign-in" className="text-gray-400 hover:text-white">Log In</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-4">Company</h4>
          <ul className="space-y-2 text-sm">
            <li><a href="#" className="text-gray-400 hover:text-white">About</a></li>
            <li><a href="#" className="text-gray-400 hover:text-white">Blog</a></li>
            <li><a href="#" className="text-gray-400 hover:text-white">Careers</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-4">Legal</h4>
          <ul className="space-y-2 text-sm">
            <li><a href="#" className="text-gray-400 hover:text-white">Privacy</a></li>
            <li><a href="#" className="text-gray-400 hover:text-white">Terms</a></li>
            <li><a href="#" className="text-gray-400 hover:text-white">Security</a></li>
          </ul>
        </div>
      </div>
      <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-gray-800 text-center text-sm text-gray-400">
        © {new Date().getFullYear()} Buddy the Underwriter. All rights reserved.
      </div>
    </footer>
  );
}
