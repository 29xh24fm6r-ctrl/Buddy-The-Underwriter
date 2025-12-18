// src/components/deals/EntityBadge.tsx
"use client";

type EntityBadgeProps = {
  entityName?: string;
  entityKind?: string;
  className?: string;
};

export function EntityBadge({ entityName, entityKind, className = "" }: EntityBadgeProps) {
  if (!entityName) return null;
  
  const getColor = (kind?: string) => {
    switch (kind) {
      case 'OPCO': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'PROPCO': return 'bg-green-100 text-green-800 border-green-300';
      case 'HOLDCO': return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'PERSON': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'GROUP': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };
  
  const getIcon = (kind?: string) => {
    switch (kind) {
      case 'OPCO': return '🏭';
      case 'PROPCO': return '🏠';
      case 'HOLDCO': return '💼';
      case 'PERSON': return '👤';
      case 'GROUP': return '🏢';
      default: return '📁';
    }
  };
  
  return (
    <span 
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${getColor(entityKind)} ${className}`}
      title={`${entityKind || 'Entity'}: ${entityName}`}
    >
      <span>{getIcon(entityKind)}</span>
      <span className="max-w-[120px] truncate">{entityName}</span>
    </span>
  );
}
