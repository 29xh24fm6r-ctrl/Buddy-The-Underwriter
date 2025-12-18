// src/components/deals/EntityAssignmentControl.tsx
"use client";

import { useState, useEffect } from "react";
import type { DealEntity } from "@/lib/entities/types";

type EntityAssignmentControlProps = {
  dealId: string;
  jobId: string;
  currentEntityId?: string;
  entities: DealEntity[];
  onAssigned?: () => void;
};

export function EntityAssignmentControl({
  dealId,
  jobId,
  currentEntityId,
  entities,
  onAssigned,
}: EntityAssignmentControlProps) {
  const [selectedEntityId, setSelectedEntityId] = useState(currentEntityId || '');
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<any>(null);
  const [showSuggestion, setShowSuggestion] = useState(false);
  
  // Non-GROUP entities only
  const businessEntities = entities.filter(e => e.entity_kind !== 'GROUP');
  
  // Load suggestion on mount if not already assigned
  useEffect(() => {
    if (!currentEntityId && !suggestion) {
      loadSuggestion();
    }
  }, [currentEntityId]);
  
  const loadSuggestion = async () => {
    try {
      const res = await fetch(
        `/api/deals/${dealId}/packs/items/${jobId}/suggest-entity`,
        { method: 'POST' }
      );
      
      if (res.ok) {
        const data = await res.json();
        if (data.suggestion) {
          setSuggestion(data.suggestion);
          setShowSuggestion(true);
        }
      }
    } catch (e) {
      console.error('Failed to load entity suggestion:', e);
    }
  };
  
  const handleAssign = async () => {
    if (!selectedEntityId) return;
    
    setLoading(true);
    try {
      const res = await fetch(
        `/api/deals/${dealId}/packs/items/${jobId}/assign-entity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: selectedEntityId }),
        }
      );
      
      if (res.ok) {
        setShowSuggestion(false);
        onAssigned?.();
      } else {
        alert('Failed to assign entity');
      }
    } catch (e) {
      console.error('Failed to assign entity:', e);
      alert('Failed to assign entity');
    } finally {
      setLoading(false);
    }
  };
  
  const handleAcceptSuggestion = async () => {
    if (!suggestion?.entity_id) return;
    
    setSelectedEntityId(suggestion.entity_id);
    setLoading(true);
    
    try {
      const res = await fetch(
        `/api/deals/${dealId}/packs/items/${jobId}/assign-entity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: suggestion.entity_id }),
        }
      );
      
      if (res.ok) {
        setShowSuggestion(false);
        onAssigned?.();
      } else {
        alert('Failed to assign entity');
      }
    } catch (e) {
      console.error('Failed to assign entity:', e);
      alert('Failed to assign entity');
    } finally {
      setLoading(false);
    }
  };
  
  if (businessEntities.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic">
        No business entities defined. Create entities first.
      </div>
    );
  }
  
  return (
    <div className="flex flex-col gap-3">
      {/* Suggestion banner */}
      {showSuggestion && suggestion && !currentEntityId && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="text-sm font-medium text-blue-900">
                ✨ Suggested: {suggestion.entity_name}
              </div>
              <div className="text-xs text-blue-700 mt-1">
                Confidence: {suggestion.confidence}%
              </div>
              <div className="text-xs text-blue-600 mt-1">
                {suggestion.reasons?.join(', ')}
              </div>
            </div>
            <button
              onClick={handleAcceptSuggestion}
              disabled={loading}
              className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Assigning...' : 'Accept'}
            </button>
          </div>
        </div>
      )}
      
      {/* Entity selector */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 min-w-[60px]">
          Entity:
        </label>
        <select
          value={selectedEntityId}
          onChange={(e) => setSelectedEntityId(e.target.value)}
          disabled={loading}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
        >
          <option value="">Select entity...</option>
          {businessEntities.map(entity => (
            <option key={entity.id} value={entity.id}>
              {entity.name} {entity.ein ? `(${entity.ein})` : ''}
            </option>
          ))}
        </select>
        
        {selectedEntityId && selectedEntityId !== currentEntityId && (
          <button
            onClick={handleAssign}
            disabled={loading}
            className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Assign'}
          </button>
        )}
      </div>
      
      {currentEntityId && (
        <div className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded">
          ✓ Assigned to {businessEntities.find(e => e.id === currentEntityId)?.name}
        </div>
      )}
    </div>
  );
}
