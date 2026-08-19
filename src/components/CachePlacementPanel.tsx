import React from 'react';
import type { CacheSlotDefinition } from '../systems/survival/portageCache';

type CachePlacementPanelProps = {
  slots: ReadonlyArray<CacheSlotDefinition>;
  selectedIds: string[];
  maxPlacements: number;
  onToggle: (slotId: string) => void;
};

export default function CachePlacementPanel({
  slots,
  selectedIds,
  maxPlacements,
  onToggle,
}: CachePlacementPanelProps) {
  if (!slots.length) return null;

  return (
    <div className="start-menu-cache-panel">
      <div className="start-menu-map-select-label">Scout Caches</div>
      <p className="start-menu-map-hint">
        Place up to {maxPlacements} cache{maxPlacements === 1 ? '' : 's'} on high ground before launch.
      </p>
      {slots.map((slot) => {
        const selected = selectedIds.includes(slot.id);
        const disabled = !selected && selectedIds.length >= maxPlacements;
        return (
          <button
            key={slot.id}
            type="button"
            className={`start-menu-cache-option ${selected ? 'active' : ''}`}
            disabled={disabled}
            onClick={() => onToggle(slot.id)}
          >
            <span className="start-menu-cache-option-title">{slot.label}</span>
            <span className="start-menu-cache-option-meta">
              Seg {slot.segmentIndex} · +{slot.retrievalBonus} on retrieve
            </span>
          </button>
        );
      })}
    </div>
  );
}
