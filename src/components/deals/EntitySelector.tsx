// src/components/deals/EntitySelector.tsx
"use client";

import type { DealEntity } from "@/lib/entities/types";

type EntitySelectorProps = {
  entities: DealEntity[];
  selectedEntityId: string | null;
  onSelectEntity: (entityId: string | null) => void;
  className?: string;
};

export function EntitySelector({
  entities,
  selectedEntityId,
  onSelectEntity,
  className = "",
}: EntitySelectorProps) {
  const groupEntity = entities.find(e => e.entity_kind === 'GROUP');
  const businessEntities = entities.filter(e => e.entity_kind !== 'GROUP');
  
  const getEntityIcon = (kind: string) => {
    switch (kind) {
      case 'GROUP': return '🏢';
      case 'OPCO': return '🏭';
      case 'PROPCO': return '🏠';
      case 'HOLDCO': return '💼';
      case 'PERSON': return '👤';
      default: return '📁';
    }
  };
  
  const getEntityLabel = (entity: DealEntity) => {
    if (entity.entity_kind === 'GROUP') {
      return `${getEntityIcon(entity.entity_kind)} ${entity.name}`;
    }
    return `${getEntityIcon(entity.entity_kind)} ${entity.name}`;
  };
  
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        Entity Scope
      </label>
      
      <div className="flex flex-col gap-1">
        {/* GROUP entity always first */}
        {groupEntity && (
          <button
            onClick={() => onSelectEntity(null)} // null = GROUP view
            className={`px-3 py-2 rounded-md text-left text-sm font-medium transition-colors ${
              selectedEntityId === null
                ? 'bg-blue-100 text-blue-900 border-2 border-blue-500'
                : 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span>{getEntityLabel(groupEntity)}</span>
              {selectedEntityId === null && (
                <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded">
                  Active
                </span>
              )}
            </div>
          </button>
        )}
        
        {/* Divider */}
        {businessEntities.length > 0 && (
          <div className="h-px bg-gray-300 my-1"></div>
        )}
        
        {/* Business entities */}
        {businessEntities.map(entity => (
          <button
            key={entity.id}
            onClick={() => onSelectEntity(entity.id)}
            className={`px-3 py-2 rounded-md text-left text-sm transition-colors ${
              selectedEntityId === entity.id
                ? 'bg-green-100 text-green-900 border-2 border-green-500'
                : 'bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <span>{getEntityLabel(entity)}</span>
              {selectedEntityId === entity.id && (
                <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded">
                  Active
                </span>
              )}
            </div>
            {entity.ein && (
              <div className="text-xs text-gray-500 mt-0.5">
                EIN: {entity.ein}
              </div>
            )}
          </button>
        ))}
      </div>
      
      {/* Add Entity button */}
      <button
        onClick={() => {
          // TODO: Open entity creation modal
          alert('Entity creation UI coming soon!');
        }}
        className="px-3 py-2 mt-2 text-sm text-blue-600 border-2 border-dashed border-blue-300 rounded-md hover:bg-blue-50 hover:border-blue-400 transition-colors"
      >
        + Add Entity
      </button>
    </div>
  );
}
