export default function HealthPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Buddy is up</h1>
      <p className="mt-3 text-white/70">
        If you can see this, routing + rendering are working.
      </p>
      <div className="mt-8">
        <a className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/15" href="/api/health">
          View JSON health
        </a>
      </div>
    </div>
  );
}
