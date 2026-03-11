/**
 * Segment Inspector Component
 * 
 * Property editor for individual track segments.
 * Provides real-time JSON updates and visual feedback.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { SegmentConfig } from '../../hooks/useLevel';

// Segment type options
const SEGMENT_TYPES = [
  { value: 'normal', label: 'Normal', description: 'Standard flowing river' },
  { value: 'waterfall', label: 'Waterfall', description: 'Vertical drop with particles' },
  { value: 'pond', label: 'Pond', description: 'Wide, calm water' },
  { value: 'splash', label: 'Splash Pool', description: 'Transition after waterfall' },
  { value: 'rapids', label: 'Rapids', description: 'Fast, turbulent water' },
];

// Biome options
const BIOME_TYPES = [
  { value: 'creek-summer', label: 'Creek Summer', color: '#87CEEB' },
  { value: 'creek-autumn', label: 'Creek Autumn', color: '#E8C070' },
  { value: 'alpine-spring', label: 'Alpine Spring', color: '#B0D4F0' },
  { value: 'canyon-sunset', label: 'Canyon Sunset', color: '#FF8C60' },
  { value: 'midnight-mist', label: 'Midnight Mist', color: '#1a2030' },
];

// Decoration types with limits
const DECORATION_TYPES: Array<{ key: string; label: string; max: number; category: 'vegetation' | 'fauna' | 'effects' }> = [
  { key: 'trees', label: 'Trees', max: 50, category: 'vegetation' },
  { key: 'grass', label: 'Grass', max: 100, category: 'vegetation' },
  { key: 'rocks', label: 'Rocks', max: 30, category: 'vegetation' },
  { key: 'wildflowers', label: 'Wildflowers', max: 50, category: 'vegetation' },
  { key: 'ferns', label: 'Ferns', max: 40, category: 'vegetation' },
  { key: 'mushrooms', label: 'Mushrooms', max: 30, category: 'vegetation' },
  { key: 'reeds', label: 'Reeds', max: 40, category: 'vegetation' },
  { key: 'driftwood', label: 'Driftwood', max: 30, category: 'vegetation' },
  { key: 'pebbles', label: 'Pebbles', max: 60, category: 'vegetation' },
  { key: 'pinecones', label: 'Pinecones', max: 40, category: 'vegetation' },
  { key: 'fireflies', label: 'Fireflies', max: 20, category: 'fauna' },
  { key: 'birds', label: 'Birds', max: 15, category: 'fauna' },
  { key: 'fish', label: 'Fish', max: 20, category: 'fauna' },
  { key: 'dragonflies', label: 'Dragonflies', max: 15, category: 'fauna' },
  { key: 'fallingLeaves', label: 'Falling Leaves', max: 30, category: 'effects' },
  { key: 'floatingLeaves', label: 'Floating Leaves', max: 20, category: 'effects' },
  { key: 'mist', label: 'Mist', max: 15, category: 'effects' },
  { key: 'waterLilies', label: 'Water Lilies', max: 20, category: 'effects' },
  { key: 'sunShafts', label: 'Sun Shafts', max: 10, category: 'effects' },
  { key: 'rapids', label: 'Rapids', max: 20, category: 'effects' },
];

interface SegmentInspectorProps {
  segment: SegmentConfig | null;
  totalSegments: number;
  onChange: (segment: SegmentConfig) => void;
  onSelectSegment: (index: number) => void;
  errors?: Array<{ field: string; error: string }>;
}

// Collapsible section component
const Section: React.FC<{ title: string; children: React.ReactNode; defaultOpen?: boolean }> = ({ 
  title, 
  children, 
  defaultOpen = false 
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div style={{ borderBottom: '1px solid #333', marginBottom: '12px' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '10px 0',
          background: 'none',
          border: 'none',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        {title}
        <span style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          ▼
        </span>
      </button>
      {isOpen && <div style={{ paddingBottom: '12px' }}>{children}</div>}
    </div>
  );
};

// Slider input component
const SliderInput: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}> = ({ label, value, min, max, step = 0.01, onChange, suffix = '' }) => (
  <div style={{ marginBottom: '12px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
      <label style={{ fontSize: '12px', color: '#aaa' }}>{label}</label>
      <span style={{ fontSize: '12px', color: '#fff' }}>
        {typeof value === 'number' ? value.toFixed(step < 0.1 ? 2 : 1) : value}{suffix}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        width: '100%',
        height: '4px',
        background: 'linear-gradient(to right, #4a9eff, #ff4a4a)',
        borderRadius: '2px',
        appearance: 'none',
        cursor: 'pointer',
      }}
    />
  </div>
);

// Number input component
const NumberInput: React.FC<{
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => (
  <div style={{ marginBottom: '12px' }}>
    <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>
      {label}
    </label>
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      style={{
        width: '100%',
        padding: '6px 10px',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: '4px',
        color: '#fff',
        fontSize: '13px',
      }}
    />
  </div>
);

export const SegmentInspector: React.FC<SegmentInspectorProps> = ({
  segment,
  totalSegments,
  onChange,
  onSelectSegment,
  errors = [],
}) => {
  const [localSegment, setLocalSegment] = useState<SegmentConfig | null>(segment);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync with parent
  useEffect(() => {
    setLocalSegment(segment);
    setHasChanges(false);
  }, [segment]);

  // Debounced update
  useEffect(() => {
    if (!localSegment || !hasChanges) return;
    
    const timer = setTimeout(() => {
      onChange(localSegment);
      setHasChanges(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [localSegment, hasChanges, onChange]);

  const updateField = useCallback(<K extends keyof SegmentConfig>(
    field: K,
    value: SegmentConfig[K]
  ) => {
    if (!localSegment) return;
    setLocalSegment({ ...localSegment, [field]: value });
    setHasChanges(true);
  }, [localSegment]);

  const updateDecoration = useCallback((key: string, value: number) => {
    if (!localSegment) return;
    setLocalSegment({
      ...localSegment,
      decorations: { ...localSegment.decorations, [key]: value },
    });
    setHasChanges(true);
  }, [localSegment]);

  const updatePhysics = useCallback((key: string, value: number) => {
    if (!localSegment) return;
    setLocalSegment({
      ...localSegment,
      physics: { ...localSegment.physics, [key]: value },
    });
    setHasChanges(true);
  }, [localSegment]);

  const updateEffects = useCallback((key: string, value: number) => {
    if (!localSegment) return;
    setLocalSegment({
      ...localSegment,
      effects: { ...localSegment.effects, [key]: value },
    });
    setHasChanges(true);
  }, [localSegment]);

  const updateSafeZone = useCallback((key: string, value: number) => {
    if (!localSegment) return;
    setLocalSegment({
      ...localSegment,
      safeZone: { ...localSegment.safeZone, [key]: value } as any,
    });
    setHasChanges(true);
  }, [localSegment]);

  const resetToDefaults = useCallback(() => {
    if (!localSegment) return;
    setLocalSegment({
      ...localSegment,
      type: 'normal',
      difficulty: 0.3,
      meanderStrength: 1.2,
      verticalBias: -0.5,
      forwardMomentum: 1.0,
      decorations: {},
      physics: {},
      effects: {},
    });
    setHasChanges(true);
  }, [localSegment]);

  // Get errors for this segment
  const segmentErrors = errors.filter(e => e.field.includes(`segments[${segment?.index}]`));
  const hasErrors = segmentErrors.length > 0;

  if (!segment || !localSegment) {
    return (
      <div style={{
        padding: '20px',
        color: '#888',
        textAlign: 'center',
        fontSize: '13px',
      }}>
        Select a segment to edit its properties
      </div>
    );
  }

  // Calculate difficulty color
  const difficultyColor = localSegment.difficulty < 0.3 
    ? '#4ade80' 
    : localSegment.difficulty < 0.6 
    ? '#facc15' 
    : localSegment.difficulty < 0.8 
    ? '#fb923c' 
    : '#ef4444';

  return (
    <div style={{
      width: '280px',
      background: '#0a0a0a',
      borderRight: '1px solid #222',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      overflowY: 'auto',
      height: '100%',
    }}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid #222' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <select
            value={segment.index}
            onChange={(e) => onSelectSegment(parseInt(e.target.value))}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {Array.from({ length: totalSegments }, (_, i) => (
              <option key={i} value={i}>Segment {i + 1}</option>
            ))}
          </select>
          {hasErrors && (
            <span style={{ color: '#ef4444', fontSize: '16px' }} title="Has validation errors">
              ⚠
            </span>
          )}
        </div>

        {/* Name input */}
        <input
          type="text"
          placeholder="Segment name..."
          value={localSegment.name || ''}
          onChange={(e) => updateField('name', e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '13px',
            marginBottom: '12px',
          }}
        />

        {/* Difficulty indicator */}
        <div style={{ 
          padding: '8px 12px', 
          background: `${difficultyColor}20`,
          border: `1px solid ${difficultyColor}40`,
          borderRadius: '4px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '12px', color: '#aaa' }}>Difficulty</span>
          <span style={{ 
            fontSize: '12px', 
            fontWeight: 600,
            color: difficultyColor,
          }}>
            {localSegment.difficulty < 0.2 ? 'Very Easy' :
             localSegment.difficulty < 0.4 ? 'Easy' :
             localSegment.difficulty < 0.6 ? 'Medium' :
             localSegment.difficulty < 0.8 ? 'Hard' : 'Extreme'}
          </span>
        </div>
      </div>

      {/* Properties */}
      <div style={{ padding: '16px' }}>
        <Section title="Basic Properties" defaultOpen>
          {/* Type selector */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>
              Segment Type
            </label>
            <select
              value={localSegment.type || 'normal'}
              onChange={(e) => updateField('type', e.target.value as any)}
              style={{
                width: '100%',
                padding: '6px 10px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '13px',
              }}
            >
              {SEGMENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <p style={{ fontSize: '11px', color: '#666', margin: '4px 0 0' }}>
              {SEGMENT_TYPES.find(t => t.value === localSegment.type)?.description}
            </p>
          </div>

          {/* Biome override */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#aaa', marginBottom: '4px' }}>
              Biome Override (optional)
            </label>
            <select
              value={localSegment.biomeOverride || ''}
              onChange={(e) => updateField('biomeOverride', e.target.value || undefined)}
              style={{
                width: '100%',
                padding: '6px 10px',
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '13px',
              }}
            >
              <option value="">Use World Biome</option>
              {BIOME_TYPES.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>

          {/* Difficulty slider */}
          <SliderInput
            label="Difficulty"
            value={localSegment.difficulty}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => updateField('difficulty', v)}
          />

          {/* Width */}
          <NumberInput
            label="Width Override"
            value={localSegment.width || 0}
            min={20}
            max={80}
            onChange={(v) => updateField('width', v || undefined)}
          />
        </Section>

        <Section title="Flow Characteristics">
          <SliderInput
            label="Meander Strength"
            value={localSegment.meanderStrength ?? 1.2}
            min={0}
            max={3}
            step={0.1}
            onChange={(v) => updateField('meanderStrength', v)}
          />
          <SliderInput
            label="Vertical Bias"
            value={localSegment.verticalBias ?? -0.5}
            min={-3}
            max={0}
            step={0.1}
            onChange={(v) => updateField('verticalBias', v)}
          />
          <SliderInput
            label="Forward Momentum"
            value={localSegment.forwardMomentum ?? 1}
            min={0.1}
            max={2}
            step={0.1}
            onChange={(v) => updateField('forwardMomentum', v)}
          />
        </Section>

        <Section title="Physics">
          <SliderInput
            label="Gravity Multiplier"
            value={localSegment.physics?.gravityMultiplier ?? 1}
            min={0.5}
            max={2}
            step={0.1}
            onChange={(v) => updatePhysics('gravityMultiplier', v)}
          />
          <SliderInput
            label="Water Flow Intensity"
            value={localSegment.physics?.waterFlowIntensity ?? 1}
            min={0}
            max={3}
            step={0.1}
            onChange={(v) => updatePhysics('waterFlowIntensity', v)}
          />
          <SliderInput
            label="Friction"
            value={localSegment.physics?.friction ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => updatePhysics('friction', v)}
          />
        </Section>

        <Section title="Decorations">
          {['vegetation', 'fauna', 'effects'].map(category => (
            <div key={category} style={{ marginBottom: '16px' }}>
              <h4 style={{ 
                fontSize: '11px', 
                textTransform: 'uppercase', 
                color: '#666',
                margin: '0 0 8px',
                letterSpacing: '0.5px',
              }}>
                {category}
              </h4>
              {DECORATION_TYPES.filter(d => d.category === category).map(dec => (
                <div key={dec.key} style={{ marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <label style={{ fontSize: '11px', color: '#888' }}>{dec.label}</label>
                    <span style={{ fontSize: '11px', color: '#aaa' }}>
                      {localSegment.decorations?.[dec.key] || 0}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={dec.max}
                    step={1}
                    value={localSegment.decorations?.[dec.key] || 0}
                    onChange={(e) => updateDecoration(dec.key, parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      height: '3px',
                      background: '#333',
                      borderRadius: '2px',
                      appearance: 'none',
                      cursor: 'pointer',
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </Section>

        <Section title="Effects">
          <NumberInput
            label="Particle Count"
            value={localSegment.effects?.particleCount || 0}
            min={0}
            max={500}
            step={10}
            onChange={(v) => updateEffects('particleCount', v)}
          />
          <SliderInput
            label="Camera Shake"
            value={localSegment.effects?.cameraShake || 0}
            min={0}
            max={1}
            step={0.1}
            onChange={(v) => updateEffects('cameraShake', v)}
          />
          <SliderInput
            label="Fog Density"
            value={localSegment.effects?.fogDensity || 0}
            min={0}
            max={1}
            step={0.1}
            onChange={(v) => updateEffects('fogDensity', v)}
          />
        </Section>

        <Section title="Safe Zone">
          <NumberInput
            label="Min Y"
            value={localSegment.safeZone?.yMin ?? -20}
            step={1}
            onChange={(v) => updateSafeZone('yMin', v)}
          />
          <NumberInput
            label="Max Y"
            value={localSegment.safeZone?.yMax ?? 20}
            step={1}
            onChange={(v) => updateSafeZone('yMax', v)}
          />
          <NumberInput
            label="Respawn Segment"
            value={localSegment.safeZone?.respawnAt ?? segment.index}
            min={0}
            max={totalSegments - 1}
            step={1}
            onChange={(v) => updateSafeZone('respawnAt', v)}
          />
        </Section>

        {/* Reset button */}
        <button
          onClick={resetToDefaults}
          style={{
            width: '100%',
            padding: '10px',
            marginTop: '16px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '4px',
            color: '#888',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#2a2a2a';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#1a1a1a';
            e.currentTarget.style.color = '#888';
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
};

export default SegmentInspector;
