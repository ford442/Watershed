import React from 'react';
import {
  LOADOUT_LIST,
  type LoadoutId,
} from '../systems/survival';
import { useT } from '../i18n/useT';

type LoadoutPickerProps = {
  selectedId: LoadoutId;
  onSelect: (id: LoadoutId) => void;
};

export default function LoadoutPicker({ selectedId, onSelect }: LoadoutPickerProps) {
  const t = useT();
  return (
    <div className="start-menu-loadout-panel">
      <div className="start-menu-map-select-label">{t('menu.loadout')}</div>
      <p className="start-menu-map-hint">{t('menu.loadout.hint')}</p>
      {LOADOUT_LIST.map((loadout) => {
        const selected = selectedId === loadout.id;
        return (
          <button
            key={loadout.id}
            type="button"
            className={`start-menu-loadout-option ${selected ? 'active' : ''}`}
            onClick={() => onSelect(loadout.id)}
          >
            <span className="start-menu-loadout-option-title">{t(loadout.labelKey)}</span>
            <span className="start-menu-loadout-option-meta">{t(loadout.descriptionKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
