export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-3 text-white/70">That route doesn't exist (or it moved).</p>
      <div className="mt-8">
        <a className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15" href="/">
          Go home
        </a>
      </div>
    </div>
  );
}
