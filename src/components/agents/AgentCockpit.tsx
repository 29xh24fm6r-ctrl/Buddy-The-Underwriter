'use client';

/**
 * SBA Agent Cockpit
 * 
 * Displays agent findings with confidence scores, citations, and override capabilities.
 * The "control center" for underwriters reviewing AI agent output.
 */

import { useState, useEffect } from 'react';
import type { AgentFinding, AgentName } from '@/lib/agents';

interface AgentCockpitProps {
  dealId: string;
}

const AGENT_LABELS: Record<AgentName, string> = {
  sba_policy: 'SBA Policy',
  eligibility: 'Eligibility',
  credit: 'Credit',
  cash_flow: 'Cash Flow',
  collateral: 'Collateral',
  management: 'Management',
  risk: 'Risk Synthesis',
  narrative: 'Narrative',
  evidence: 'Evidence',
  banker_copilot: 'Banker Copilot',
};

const STATUS_COLORS = {
  pass: 'bg-green-100 text-green-800',
  fail: 'bg-red-100 text-red-800',
  conditional: 'bg-yellow-100 text-yellow-800',
  pending: 'bg-gray-100 text-gray-800',
  override: 'bg-purple-100 text-purple-800',
};

export default function AgentCockpit({ dealId }: AgentCockpitProps) {
  const [findings, setFindings] = useState<AgentFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);

  useEffect(() => {
    loadFindings();
  }, [dealId]);

  async function loadFindings() {
    try {
      const res = await fetch(`/api/deals/${dealId}/agents/findings`);
      const json = await res.json();
      
      if (json.ok) {
        setFindings(json.data);
      }
    } catch (error) {
      console.error('Failed to load findings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function executeAgents() {
    setExecuting(true);
    
    try {
      const res = await fetch(`/api/deals/${dealId}/agents/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force_refresh: true }),
      });
      
      const json = await res.json();
      
      if (json.ok) {
        await loadFindings();
      }
    } catch (error) {
      console.error('Failed to execute agents:', error);
    } finally {
      setExecuting(false);
    }
  }

  // Group findings by agent
  const findingsByAgent = findings.reduce((acc, finding) => {
    if (!acc[finding.agent_name]) {
      acc[finding.agent_name] = [];
    }
    acc[finding.agent_name].push(finding);
    return acc;
  }, {} as Record<AgentName, AgentFinding[]>);

  const selectedFindings = selectedAgent ? findingsByAgent[selectedAgent] || [] : [];

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading agent findings...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border">
      {/* Header */}
      <div className="p-6 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">SBA Agent Cockpit</h2>
            <p className="mt-1 text-sm text-gray-600">
              AI-powered underwriting analysis with confidence scores
            </p>
          </div>
          
          <button
            onClick={executeAgents}
            disabled={executing}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {executing ? 'Executing...' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {/* Agent Grid */}
      <div className="p-6">
        {findings.length === 0 ? (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No agent findings</h3>
            <p className="mt-1 text-sm text-gray-500">
              Click "Run Analysis" to execute the SBA underwriting agent swarm
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Agent Cards */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
                Agents ({Object.keys(findingsByAgent).length})
              </h3>
              
              {Object.entries(findingsByAgent).map(([agentName, agentFindings]) => {
                const latest = agentFindings[0];
                const isSelected = selectedAgent === agentName;
                
                return (
                  <button
                    key={agentName}
                    onClick={() => setSelectedAgent(agentName as AgentName)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {AGENT_LABELS[agentName as AgentName]}
                          </span>
                          
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[latest.status]}`}>
                            {latest.status}
                          </span>
                        </div>
                        
                        <div className="mt-2 flex items-center gap-4">
                          {/* Confidence Bar */}
                          <div className="flex-1">
                            <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                              <span>Confidence</span>
                              <span className="font-medium">{(latest.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all ${
                                  latest.confidence >= 0.9
                                    ? 'bg-green-500'
                                    : latest.confidence >= 0.7
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${latest.confidence * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>
                        
                        {latest.requires_human_review && (
                          <div className="mt-2 flex items-center gap-1 text-xs text-orange-600">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Requires review
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Finding Details */}
            <div>
              {selectedAgent ? (
                <div className="sticky top-6">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
                    {AGENT_LABELS[selectedAgent]} Details
                  </h3>
                  
                  <div className="bg-gray-50 rounded-lg border p-4 space-y-4 max-h-[600px] overflow-y-auto">
                    {selectedFindings.map((finding, idx) => (
                      <div key={finding.id || idx} className="bg-white p-4 rounded-lg border">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[finding.status]}`}>
                              {finding.status}
                            </span>
                            
                            <div className="mt-2 text-sm text-gray-600">
                              <strong>Type:</strong> {finding.finding_type}
                            </div>
                            
                            <div className="mt-2 text-sm text-gray-600">
                              <strong>Confidence:</strong> {(finding.confidence * 100).toFixed(1)}%
                            </div>
                            
                            {finding.output_json && (
                              <div className="mt-4">
                                <div className="text-xs font-medium text-gray-700 mb-2">Output:</div>
                                <pre className="text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                                  {JSON.stringify(finding.output_json, null, 2)}
                                </pre>
                              </div>
                            )}
                            
                            <div className="mt-3 text-xs text-gray-500">
                              {new Date(finding.created_at!).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <p>Select an agent to view details</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
