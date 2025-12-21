import "server-only";

/**
 * Evidence Graph — Visual representation of AI decision reasoning.
 * Shows: Facts → Sources → Spans → Decisions
 */

export type EvidenceNodeType = "fact" | "source" | "span" | "decision";

export type EvidenceNode = {
  id: string;
  type: EvidenceNodeType;
  label: string;
  data: any; // Type-specific payload
  confidence?: number | null;
  created_at?: string;
};

export type EvidenceEdge = {
  id: string;
  from: string; // node id
  to: string; // node id
  label?: string;
  strength?: number; // 0-100 (how strong is this connection)
};

export type EvidenceGraph = {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  metadata: {
    deal_id: string;
    generated_at: string;
    scope?: string; // e.g., "doc_intel", "pricing", "uw_copilot"
  };
};

/**
 * Build evidence graph from AI events and doc intel results.
 * This creates a visual dependency graph showing reasoning flow.
 */
export function buildEvidenceGraph(args: {
  dealId: string;
  aiEvents: Array<{
    id: string;
    scope: string;
    action: string;
    input_json: any;
    output_json: any;
    evidence_json: any;
    confidence: number | null;
    created_at: string;
  }>;
  docIntelResults: Array<{
    file_id: string;
    doc_type: string;
    evidence_json: any;
    confidence: number | null;
  }>;
}): EvidenceGraph {
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];

  // Create source nodes (documents)
  const sourceNodes = new Map<string, EvidenceNode>();
  for (const docIntel of args.docIntelResults) {
    const sourceNode: EvidenceNode = {
      id: `source_${docIntel.file_id}`,
      type: "source",
      label: docIntel.doc_type || "Unknown Document",
      data: {
        file_id: docIntel.file_id,
        doc_type: docIntel.doc_type,
      },
      confidence: docIntel.confidence,
    };
    sourceNodes.set(docIntel.file_id, sourceNode);
    nodes.push(sourceNode);
  }

  // Create fact nodes (extracted data points)
  let factIdx = 0;
  for (const docIntel of args.docIntelResults) {
    const evidenceArray = (docIntel.evidence_json as any)?.evidence || [];

    for (const ev of evidenceArray.slice(0, 5)) {
      // limit to top 5 facts per doc
      const factNode: EvidenceNode = {
        id: `fact_${factIdx++}`,
        type: "fact",
        label: ev.note || ev.kind || "Evidence fact",
        data: {
          kind: ev.kind,
          note: ev.note,
          source_file_id: docIntel.file_id,
        },
      };
      nodes.push(factNode);

      // Link fact → source
      edges.push({
        id: `edge_fact_to_source_${factNode.id}`,
        from: factNode.id,
        to: `source_${docIntel.file_id}`,
        label: "extracted from",
        strength: 80,
      });
    }
  }

  // Create span nodes (OCR excerpts with highlights)
  let spanIdx = 0;
  for (const docIntel of args.docIntelResults) {
    const spanArray = (docIntel.evidence_json as any)?.evidence_spans || [];

    for (const span of spanArray.slice(0, 3)) {
      // limit to top 3 spans per doc
      const spanNode: EvidenceNode = {
        id: `span_${spanIdx++}`,
        type: "span",
        label: span.label || "OCR excerpt",
        data: {
          attachment_id: span.attachment_id,
          start: span.start,
          end: span.end,
          label: span.label,
        },
        confidence: span.confidence,
      };
      nodes.push(spanNode);

      // Link span → source
      edges.push({
        id: `edge_span_to_source_${spanNode.id}`,
        from: spanNode.id,
        to: `source_${docIntel.file_id}`,
        label: "highlights",
        strength: 90,
      });
    }
  }

  // Create decision nodes (AI conclusions)
  let decisionIdx = 0;
  for (const event of args.aiEvents) {
    if (!event.output_json) continue;

    const decisionNode: EvidenceNode = {
      id: `decision_${decisionIdx++}`,
      type: "decision",
      label: `${event.scope}: ${event.action}`,
      data: {
        scope: event.scope,
        action: event.action,
        output: event.output_json,
      },
      confidence: event.confidence,
      created_at: event.created_at,
    };
    nodes.push(decisionNode);

    // Link decision → facts (if evidence_json references them)
    const evidenceArray = (event.evidence_json as any)?.evidence || [];
    for (const ev of evidenceArray.slice(0, 3)) {
      // Find matching fact nodes by note similarity (simplified)
      const matchingFact = nodes.find(
        (n) => n.type === "fact" && n.label.toLowerCase().includes(String(ev.note || "").toLowerCase())
      );

      if (matchingFact) {
        edges.push({
          id: `edge_decision_to_fact_${decisionNode.id}_${matchingFact.id}`,
          from: decisionNode.id,
          to: matchingFact.id,
          label: "based on",
          strength: 70,
        });
      }
    }
  }

  return {
    nodes,
    edges,
    metadata: {
      deal_id: args.dealId,
      generated_at: new Date().toISOString(),
    },
  };
}

/**
 * Get all nodes reachable from a given node (upstream dependencies).
 * Useful for "show me everything that led to this decision".
 */
export function getUpstreamNodes(
  graph: EvidenceGraph,
  startNodeId: string
): Set<string> {
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;

    visited.add(nodeId);

    // Find edges where this node is the "from" (points to dependencies)
    const outgoingEdges = graph.edges.filter((e) => e.from === nodeId);
    for (const edge of outgoingEdges) {
      if (!visited.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  return visited;
}

/**
 * Get all nodes that depend on a given node (downstream impact).
 * Useful for "show me everything that uses this document".
 */
export function getDownstreamNodes(
  graph: EvidenceGraph,
  startNodeId: string
): Set<string> {
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;

    visited.add(nodeId);

    // Find edges where this node is the "to" (things that point to it)
    const incomingEdges = graph.edges.filter((e) => e.to === nodeId);
    for (const edge of incomingEdges) {
      if (!visited.has(edge.from)) {
        queue.push(edge.from);
      }
    }
  }

  return visited;
}
