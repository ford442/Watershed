import React from 'react';
import type { CacheSlotDefinition } from '../systems/survival/portageCache';
import { useT } from '../i18n/useT';

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
  const t = useT();
  if (!slots.length) return null;

  return (
    <div className="start-menu-cache-panel">
      <div className="start-menu-map-select-label">{t('menu.caches')}</div>
      <p className="start-menu-map-hint">{t('menu.caches.hint', { count: maxPlacements })}</p>
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
            {/* Slot names are authored map content (survivalMetadata), not UI chrome. */}
            <span className="start-menu-cache-option-title">{slot.label}</span>
            <span className="start-menu-cache-option-meta">
              {t('menu.caches.slotMeta', { segment: slot.segmentIndex, bonus: slot.retrievalBonus })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
