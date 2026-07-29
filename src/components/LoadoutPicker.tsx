import React from 'react';
import {
  LOADOUT_LIST,
  type LoadoutId,
} from '../systems/survival';

type LoadoutPickerProps = {
  selectedId: LoadoutId;
  onSelect: (id: LoadoutId) => void;
};

export default function LoadoutPicker({ selectedId, onSelect }: LoadoutPickerProps) {
  return (
    <div className="start-menu-loadout-panel">
      <div className="start-menu-map-select-label">Gear Loadout</div>
      <p className="start-menu-map-hint">
        Mass vs insulation — affects cold exposure and sprint recovery.
      </p>
      {LOADOUT_LIST.map((loadout) => {
        const selected = selectedId === loadout.id;
        return (
          <button
            key={loadout.id}
            type="button"
            className={`start-menu-loadout-option ${selected ? 'active' : ''}`}
            onClick={() => onSelect(loadout.id)}
          >
            <span className="start-menu-loadout-option-title">{loadout.label}</span>
            <span className="start-menu-loadout-option-meta">{loadout.description}</span>
          </button>
        );
      })}
    </div>
  );
}
