"use client";

import { useState } from "react";
import type { EvidenceGraph, EvidenceNode, EvidenceEdge, EvidenceNodeType } from "@/lib/evidence/graph";

type EvidenceGraphViewProps = {
  graph: EvidenceGraph;
  onNodeClick?: (node: EvidenceNode) => void;
};

/**
 * Evidence Graph Visualization — Interactive dependency graph.
 * Shows: Facts → Sources → Spans → Decisions.
 * 
 * NOTE: This is a simplified SVG-based layout. For production, consider:
 * - react-flow or @xyflow/react for advanced graph rendering
 * - dagre or elk for automatic graph layout algorithms
 * - cytoscape.js for complex graph analytics
 */
export function EvidenceGraphView(props: EvidenceGraphViewProps) {
  const { graph, onNodeClick } = props;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Simple force-directed layout (very basic, for demo purposes)
  const layout = calculateSimpleLayout(graph);

  const handleNodeClick = (node: EvidenceNode) => {
    setSelectedNodeId(node.id);
    if (onNodeClick) onNodeClick(node);
  };

  return (
    <div className="relative h-full w-full overflow-auto rounded-lg border border-gray-200 bg-gray-50">
      <svg
        width="1200"
        height="800"
        className="mx-auto"
        viewBox="0 0 1200 800"
      >
        {/* Render edges first (behind nodes) */}
        {graph.edges.map((edge) => {
          const fromNode = layout.nodes.find((n) => n.id === edge.from);
          const toNode = layout.nodes.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const opacity = edge.strength ? edge.strength / 100 : 0.5;

          return (
            <g key={edge.id}>
              <line
                x1={fromNode.x}
                y1={fromNode.y}
                x2={toNode.x}
                y2={toNode.y}
                stroke="#9ca3af"
                strokeWidth="2"
                strokeOpacity={opacity}
                markerEnd="url(#arrowhead)"
              />
              {edge.label ? (
                <text
                  x={(fromNode.x + toNode.x) / 2}
                  y={(fromNode.y + toNode.y) / 2 - 5}
                  fontSize="11"
                  fill="#6b7280"
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Render nodes */}
        {layout.nodes.map((node) => {
          const isSelected = selectedNodeId === node.id;
          const isHovered = hoveredNodeId === node.id;

          const { fill, stroke, strokeWidth } = getNodeStyle(
            node.type,
            isSelected,
            isHovered
          );

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => handleNodeClick(node)}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Node circle */}
              <circle
                r={node.type === "decision" ? 40 : 30}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
              />

              {/* Node label */}
              <text
                y="4"
                fontSize="12"
                fontWeight="600"
                fill="#111"
                textAnchor="middle"
                className="pointer-events-none select-none"
              >
                {truncate(node.label, node.type === "decision" ? 10 : 8)}
              </text>

              {/* Confidence badge */}
              {node.confidence !== null && node.confidence !== undefined ? (
                <text
                  y="16"
                  fontSize="10"
                  fill="#6b7280"
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                >
                  {Math.round(node.confidence)}%
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Arrow marker definition */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,6 L9,3 z" fill="#9ca3af" />
          </marker>
        </defs>
      </svg>

      {/* Selected node details */}
      {selectedNodeId ? (
        <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-gray-300 bg-white p-4 shadow-lg">
          <NodeDetails
            node={graph.nodes.find((n) => n.id === selectedNodeId)!}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      ) : null}

      {/* Legend */}
      <div className="absolute right-4 top-4 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="text-xs font-semibold text-gray-700">Legend</div>
        <div className="mt-2 space-y-1.5">
          <LegendItem color="#fbbf24" label="Decision" />
          <LegendItem color="#60a5fa" label="Fact" />
          <LegendItem color="#34d399" label="Source" />
          <LegendItem color="#a78bfa" label="Span" />
        </div>
      </div>
    </div>
  );
}

function LegendItem(props: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-3 w-3 rounded-full border border-gray-300"
        style={{ backgroundColor: props.color }}
      />
      <span className="text-xs text-gray-600">{props.label}</span>
    </div>
  );
}

function NodeDetails(props: { node: EvidenceNode; onClose: () => void }) {
  const { node, onClose } = props;

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">{node.label}</div>
          <div className="mt-1 text-xs text-gray-600">Type: {node.type}</div>
          {node.confidence ? (
            <div className="mt-1 text-xs text-gray-600">
              Confidence: {Math.round(node.confidence)}%
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      {node.data ? (
        <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-2">
          <pre className="max-h-32 overflow-auto text-[10px] text-gray-700">
            {JSON.stringify(node.data, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// Simplified layout algorithm (hierarchical by type)
function calculateSimpleLayout(graph: EvidenceGraph): {
  nodes: Array<EvidenceNode & { x: number; y: number }>;
} {
  const typeOrder: EvidenceNodeType[] = ["source", "span", "fact", "decision"];
  const layerSpacing = 250;
  const nodeSpacing = 100;

  const nodesByType = new Map<EvidenceNodeType, EvidenceNode[]>();
  for (const type of typeOrder) {
    nodesByType.set(type, graph.nodes.filter((n) => n.type === type));
  }

  const positioned: Array<EvidenceNode & { x: number; y: number }> = [];

  let x = 100;
  for (const type of typeOrder) {
    const nodesInLayer = nodesByType.get(type) || [];
    const layerHeight = (nodesInLayer.length - 1) * nodeSpacing;
    let y = 400 - layerHeight / 2; // center vertically

    for (const node of nodesInLayer) {
      positioned.push({ ...node, x, y });
      y += nodeSpacing;
    }

    x += layerSpacing;
  }

  return { nodes: positioned };
}

function getNodeStyle(
  type: EvidenceNodeType,
  isSelected: boolean,
  isHovered: boolean
) {
  const colors = {
    decision: "#fbbf24", // yellow
    fact: "#60a5fa", // blue
    source: "#34d399", // green
    span: "#a78bfa", // purple
  };

  const fill = colors[type] || "#d1d5db";
  const stroke = isSelected ? "#111" : isHovered ? "#374151" : "#9ca3af";
  const strokeWidth = isSelected ? 3 : isHovered ? 2 : 1;

  return { fill, stroke, strokeWidth };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
