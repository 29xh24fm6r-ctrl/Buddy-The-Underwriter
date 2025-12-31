import { Container } from "@/components/marketing/MarketingShell";

export function MarketingFooter() {
  return (
    <footer className="border-t border-black/10 py-10">
      <Container className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-ink-muted">
          <div className="font-medium text-ink-strong">Buddy</div>
          <div>Loan Operations System — built for real commercial lending.</div>
        </div>

        <div className="flex items-center gap-4 text-sm text-ink-muted">
          <a className="hover:text-ink-strong" href="#what">What</a>
          <a className="hover:text-ink-strong" href="#how">How</a>
          <a className="hover:text-ink-strong" href="#who">Who</a>
          <a className="hover:text-ink-strong" href="#moat">Why</a>
        </div>
      </Container>
    </footer>
  );
}
