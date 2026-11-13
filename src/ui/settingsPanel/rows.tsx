/**
 * The Options panel's shared rows (#559 C, from `SettingsPanel.tsx`): a
 * labelled slider, a labelled on/off switch, a labelled radio group, and the
 * percent formatter the sliders share.
 */
import React from 'react';
import { useT } from '../../i18n/useT';
import type { PlainKey } from '../../i18n/i18n';
import { formatPercent } from '../../i18n/format';

export const percent = (v: number) => formatPercent(v);

/** A labelled slider row, shared by the Comfort page. */
export const SliderRow: React.FC<{
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}> = ({ id, label, min, max, step, value, format, onChange }) => (
  <div className="settings-panel-row">
    <label className="settings-panel-label" htmlFor={id}>
      {label}
    </label>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="settings-panel-slider"
    />
    <span className="settings-panel-value">{format(value)}</span>
  </div>
);

/** A labelled on/off switch row. */
export const ToggleRow: React.FC<{ id: string; label: string; value: boolean; onChange: (v: boolean) => void }> = ({
  id,
  label,
  value,
  onChange,
}) => {
  const t = useT();
  return (
    <div className="settings-panel-row">
      <label className="settings-panel-label" htmlFor={id}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        className={`settings-panel-toggle ${value ? 'on' : ''}`}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
      >
        {value ? t('settings.on') : t('settings.off')}
      </button>
    </div>
  );
};

/** A row of mutually exclusive buttons (radio group), labelled. */
export function ChoiceRow<V extends string>({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly (readonly [V, PlainKey])[];
  value: V;
  onChange: (v: V) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="settings-panel-row">
      <span className="settings-panel-label" id={`${id}-label`}>
        {label}
      </span>
      <div className="settings-panel-quality-buttons" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map(([v, key]) => (
          <button
            key={v}
            type="button"
            role="radio"
            className={`settings-panel-quality-btn ${value === v ? 'active' : ''}`}
            onClick={() => onChange(v)}
            aria-checked={value === v}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
