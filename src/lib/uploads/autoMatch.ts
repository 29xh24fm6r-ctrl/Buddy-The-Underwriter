type InboxRow = {
  id: string;
  deal_id: string;
  hinted_doc_type: string | null;
  hinted_category: string | null;
  filename: string;
};

type ReqRow = {
  id: string;
  title: string;
  category: string;
  doc_type: string | null;
  status: string;
};

function norm(s: string) {
  return (s || "").toLowerCase();
}

export function computeMatch(inbox: InboxRow, reqs: ReqRow[]): { requestId: string | null; confidence: number; reason: string } {
  const open = reqs.filter(r => r.status === "requested");

  if (!open.length) return { requestId: null, confidence: 0, reason: "no_open_requests" };

  const hintedDoc = norm(inbox.hinted_doc_type || "");
  const hintedCat = norm(inbox.hinted_category || "");
  const fname = norm(inbox.filename || "");

  let best: { id: string; score: number; reason: string } = { id: open[0].id, score: 0, reason: "default" };

  for (const r of open) {
    let score = 0;
    let reason = "";

    const rDoc = norm(r.doc_type || "");
    const rCat = norm(r.category || "");
    const rTitle = norm(r.title || "");

    if (hintedDoc && rDoc && hintedDoc === rDoc) { score += 70; reason = "hinted_doc_type"; }
    if (hintedCat && rCat && hintedCat === rCat) { score += 20; reason = reason ? `${reason}+hinted_category` : "hinted_category"; }

    // filename weak signal
    if (rDoc && fname.includes(rDoc)) { score += 15; reason = reason ? `${reason}+fname_doc` : "fname_doc"; }
    if (rCat && fname.includes(rCat)) { score += 10; reason = reason ? `${reason}+fname_cat` : "fname_cat"; }
    if (rTitle && (fname.includes(rTitle.split(" ")[0]) || fname.includes(rTitle.replace(/\s+/g, "_")))) {
      score += 10; reason = reason ? `${reason}+fname_title` : "fname_title";
    }

    if (score > best.score) best = { id: r.id, score, reason: reason || "score" };
  }

  if (best.score < 40) return { requestId: null, confidence: best.score, reason: "low_confidence" };
  return { requestId: best.id, confidence: Math.min(100, best.score), reason: best.reason };
}
