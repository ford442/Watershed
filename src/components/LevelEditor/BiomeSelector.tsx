/**
 * Biome Selector Component
 * 
 * Grid-based biome picker with visual thumbnails and parameter display.
 */

import React from 'react';

// Biome definitions with visual properties
interface BiomeDefinition {
  id: string;
  name: string;
  description: string;
  skyColor: string;
  fogColor: string;
  waterColor: string;
  lightingTemp: 'warm' | 'cool' | 'neutral';
  features: string[];
  preview: string;
}

const BIOMES: BiomeDefinition[] = [
  {
    id: 'creek-summer',
    name: 'Creek Summer',
    description: 'Lush green banks, bright skies, abundant wildlife',
    skyColor: '#87CEEB',
    fogColor: '#D4E9F7',
    waterColor: '#1a7b9c',
    lightingTemp: 'warm',
    features: ['Fireflies', 'Birds', 'Dragonflies', 'Green foliage'],
    preview: '🌲',
  },
  {
    id: 'creek-autumn',
    name: 'Creek Autumn',
    description: 'Golden foliage, falling leaves, mushrooms',
    skyColor: '#E8C070',
    fogColor: '#B89868',
    waterColor: '#2a5a6a',
    lightingTemp: 'warm',
    features: ['Falling leaves', 'Mushrooms', 'Golden trees', 'Orange glow'],
    preview: '🍂',
  },
  {
    id: 'alpine-spring',
    name: 'Alpine Spring',
    description: 'Snowmelt streams, evergreens, crisp air',
    skyColor: '#B0D4F0',
    fogColor: '#C8E0F0',
    waterColor: '#2a7a9c',
    lightingTemp: 'cool',
    features: ['Cold mist', 'Evergreens', 'Clear water', 'Rocky terrain'],
    preview: '⛰️',
  },
  {
    id: 'canyon-sunset',
    name: 'Canyon Sunset',
    description: 'Warm oranges, long shadows, desert vegetation',
    skyColor: '#FF8C60',
    fogColor: '#FFB090',
    waterColor: '#8a4a3a',
    lightingTemp: 'warm',
    features: ['Long shadows', 'Red rock', 'Warm glow', 'Sparse vegetation'],
    preview: '🌅',
  },
  {
    id: 'midnight-mist',
    name: 'Midnight Mist',
    description: 'Dark atmosphere, heavy fog, mysterious',
    skyColor: '#1a2030',
    fogColor: '#2a3040',
    waterColor: '#0a3a4a',
    lightingTemp: 'cool',
    features: ['Heavy fog', 'Fireflies', 'Dark water', 'Mysterious'],
    preview: '🌙',
  },
];

interface BiomeSelectorProps {
  selectedBiome: string;
  onSelect: (biomeId: string) => void;
  onApplyToAll?: () => void;
  onApplyToSegment?: (segmentIndex: number) => void;
}

export const BiomeSelector: React.FC<BiomeSelectorProps> = ({
  selectedBiome,
  onSelect,
  onApplyToAll,
  onApplyToSegment,
}) => {
  const selectedBiomeData = BIOMES.find(b => b.id === selectedBiome);

  return (
    <div style={{
      width: '240px',
      background: '#0a0a0a',
      borderLeft: '1px solid #222',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      height: '100%',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid #222' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600 }}>Biome</h3>
        <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>
          Select the visual theme for your level
        </p>
      </div>

      {/* Biome Grid */}
      <div style={{ padding: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {BIOMES.map(biome => (
            <button
              key={biome.id}
              onClick={() => onSelect(biome.id)}
              style={{
                padding: '12px 8px',
                background: selectedBiome === biome.id ? '#1a3a5a' : '#1a1a1a',
                border: `2px solid ${selectedBiome === biome.id ? '#4a9eff' : '#333'}`,
                borderRadius: '8px',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (selectedBiome !== biome.id) {
                  e.currentTarget.style.borderColor = '#555';
                }
              }}
              onMouseLeave={(e) => {
                if (selectedBiome !== biome.id) {
                  e.currentTarget.style.borderColor = '#333';
                }
              }}
            >
              <div style={{ fontSize: '32px', marginBottom: '8px' }}>
                {biome.preview}
              </div>
              <div style={{ 
                fontSize: '12px', 
                fontWeight: 600,
                color: selectedBiome === biome.id ? '#fff' : '#ccc',
              }}>
                {biome.name}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Biome Details */}
      {selectedBiomeData && (
        <div style={{ padding: '16px', borderTop: '1px solid #222' }}>
          <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600 }}>
            {selectedBiomeData.name}
          </h4>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#888', lineHeight: 1.4 }}>
            {selectedBiomeData.description}
          </p>

          {/* Color Palette */}
          <div style={{ marginBottom: '16px' }}>
            <h5 style={{ margin: '0 0 8px', fontSize: '11px', color: '#666', textTransform: 'uppercase' }}>
              Color Palette
            </h5>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ textAlign: 'center' }}>
                <div 
                  style={{ 
                    width: '40px', 
                    height: '40px', 
                    borderRadius: '6px',
                    background: selectedBiomeData.skyColor,
                    marginBottom: '4px',
                    border: '1px solid #333',
                  }}
                  title="Sky"
                />
                <span style={{ fontSize: '10px', color: '#666' }}>Sky</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div 
                  style={{ 
                    width: '40px', 
                    height: '40px', 
                    borderRadius: '6px',
                    background: selectedBiomeData.fogColor,
                    marginBottom: '4px',
                    border: '1px solid #333',
                  }}
                  title="Fog"
                />
                <span style={{ fontSize: '10px', color: '#666' }}>Fog</span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div 
                  style={{ 
                    width: '40px', 
                    height: '40px', 
                    borderRadius: '6px',
                    background: selectedBiomeData.waterColor,
                    marginBottom: '4px',
                    border: '1px solid #333',
                  }}
                  title="Water"
                />
                <span style={{ fontSize: '10px', color: '#666' }}>Water</span>
              </div>
            </div>
          </div>

          {/* Lighting Temperature */}
          <div style={{ marginBottom: '16px' }}>
            <h5 style={{ margin: '0 0 8px', fontSize: '11px', color: '#666', textTransform: 'uppercase' }}>
              Lighting
            </h5>
            <div style={{
              padding: '8px 12px',
              background: '#1a1a1a',
              borderRadius: '4px',
              fontSize: '12px',
              color: '#aaa',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                background: selectedBiomeData.lightingTemp === 'warm' ? '#ffaa55' : 
                           selectedBiomeData.lightingTemp === 'cool' ? '#5599ff' : '#aaaaaa',
              }} />
              {selectedBiomeData.lightingTemp.charAt(0).toUpperCase() + selectedBiomeData.lightingTemp.slice(1)}
            </div>
          </div>

          {/* Features */}
          <div>
            <h5 style={{ margin: '0 0 8px', fontSize: '11px', color: '#666', textTransform: 'uppercase' }}>
              Key Features
            </h5>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {selectedBiomeData.features.map((feature, i) => (
                <span
                  key={i}
                  style={{
                    padding: '4px 8px',
                    background: '#1a1a1a',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: '#888',
                  }}
                >
                  {feature}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Apply Buttons */}
      <div style={{ padding: '16px', borderTop: '1px solid #222' }}>
        <button
          onClick={onApplyToAll}
          style={{
            width: '100%',
            padding: '10px',
            marginBottom: '8px',
            background: '#1a3a5a',
            border: '1px solid #4a9eff',
            borderRadius: '4px',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#2a4a6a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#1a3a5a';
          }}
        >
          Apply to All Segments
        </button>
        <button
          onClick={() => onApplyToSegment?.(0)}
          style={{
            width: '100%',
            padding: '10px',
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
          Apply to Current Segment
        </button>
      </div>
    </div>
  );
};

export default BiomeSelector;
