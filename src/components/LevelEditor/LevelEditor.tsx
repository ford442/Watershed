/**
 * Level Editor Component
 * 
 * Main panel that combines all editor UI components:
 * - Segment Inspector (left)
 * - 3D Viewport (center) 
 * - Biome Selector (right)
 * - Error Panel (bottom)
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls, Grid } from '@react-three/drei';
import { SegmentInspector } from './SegmentInspector';
import { BiomeSelector } from './BiomeSelector';
import { ErrorPanel } from './ErrorPanel';
import { PathVisualizer } from './PathVisualizer';
import { useLevelEditor, EditorSegmentConfig } from '../../hooks/useLevelEditor';
import { validateEditorLevel, EditorValidationError } from '../../utils/levelEditorValidator';

interface LevelEditorProps {
  initialLevelData?: any;
  onSave?: (levelData: any) => void;
  onPlay?: (levelData: any) => void;
  onExport?: (levelData: any) => void;
}

// Toolbar component
const Toolbar: React.FC<{
  onSave: () => void;
  onPlay: () => void;
  onExport: () => void;
  onLoadFile: () => void;
  onNew: () => void;
  hasErrors: boolean;
}> = ({ onSave, onPlay, onExport, onLoadFile, onNew, hasErrors }) => (
  <div style={{
    height: '48px',
    background: '#0a0a0a',
    borderBottom: '1px solid #222',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: '12px',
  }}>
    <span style={{ 
      fontSize: '16px', 
      fontWeight: 700, 
      color: '#fff',
      marginRight: '16px',
    }}>
      WATERSHED EDITOR
    </span>

    <button onClick={onNew} style={toolbarButtonStyle}>
      New
    </button>
    <button onClick={onLoadFile} style={toolbarButtonStyle}>
      Open
    </button>
    <button onClick={onSave} style={toolbarButtonStyle}>
      Save
    </button>
    <div style={{ width: '1px', height: '24px', background: '#333' }} />
    <button 
      onClick={onPlay} 
      style={{
        ...toolbarButtonStyle,
        background: hasErrors ? '#333' : '#1a5a1a',
        borderColor: hasErrors ? '#444' : '#3a9a3a',
        opacity: hasErrors ? 0.5 : 1,
        cursor: hasErrors ? 'not-allowed' : 'pointer',
      }}
      disabled={hasErrors}
    >
      ▶ Play Test
    </button>
    <button onClick={onExport} style={toolbarButtonStyle}>
      Export JSON
    </button>

    {hasErrors && (
      <span style={{ 
        marginLeft: 'auto',
        color: '#ef4444',
        fontSize: '12px',
      }}>
        Fix errors before playing
      </span>
    )}
  </div>
);

const toolbarButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: '4px',
  color: '#ccc',
  fontSize: '12px',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

// Main editor component
export const LevelEditor: React.FC<LevelEditorProps> = ({
  initialLevelData,
  onSave,
  onPlay,
  onExport,
}) => {
  const hook = useLevelEditor();

  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);
  const [showErrors, setShowErrors] = useState(true);
  const [viewportMode, setViewportMode] = useState<'3d' | 'top' | 'side'>('3d');
  /** Non-null value shows the export modal */
  const [exportJson, setExportJson] = useState<string | null>(null);

  // Load initial data once
  useEffect(() => {
    if (initialLevelData && !hook.isLoaded) {
      hook.loadFromJSON(initialLevelData);
    }
  }, [initialLevelData, hook.isLoaded, hook.loadFromJSON]);

  // Compute validation from current segments
  const validationResult = validateEditorLevel(hook.segments);

  // Handle segment update
  const handleSegmentChange = useCallback((updatedSegment: EditorSegmentConfig) => {
    hook.updateSegment(updatedSegment.id, updatedSegment);
  }, [hook.updateSegment]);

  // Handle biome change (world biome)
  const handleBiomeChange = useCallback((biomeId: string) => {
    hook.setWorldBiome(biomeId);
  }, [hook.setWorldBiome]);

  // Apply world biome to all segments (re-triggers the update)
  const handleApplyBiomeToAll = useCallback(() => {
    hook.setWorldBiome(hook.worldBiome);
  }, [hook.worldBiome, hook.setWorldBiome]);

  // Apply world biome to current segment
  const handleApplyBiomeToSegment = useCallback(() => {
    const seg = hook.segments.find(s => s.index === selectedSegmentIndex);
    if (seg) {
      hook.updateSegment(seg.id, { biomeOverride: hook.worldBiome, biome: hook.worldBiome });
    }
  }, [hook.segments, hook.worldBiome, hook.updateSegment, selectedSegmentIndex]);

  // Navigate to field from error
  const handleNavigateToField = useCallback((field: string) => {
    if (field.includes('segments[')) {
      const match = field.match(/segments\[(\d+)\]/);
      if (match) {
        setSelectedSegmentIndex(parseInt(match[1]));
      }
    }
  }, []);

  // Handle file load
  const handleLoadFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.wlf.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const text = await file.text();
          const json = JSON.parse(text);
          hook.loadFromJSON(json);
        } catch (err) {
          console.error('[LevelEditor] Failed to parse file:', err);
        }
      }
    };
    input.click();
  }, [hook.loadFromJSON]);

  // Handle new level
  const handleNew = useCallback(() => {
    const template = createDefaultLevel();
    hook.loadFromJSON(template);
  }, [hook.loadFromJSON]);

  // Handle export — show modal with JSON string
  const handleExport = useCallback(() => {
    const json = hook.exportAsJSON();
    setExportJson(json);
    onExport?.(json);
  }, [hook.exportAsJSON, onExport]);

  // Handle play — navigate to game root
  const handlePlay = useCallback(() => {
    if (onPlay) {
      onPlay(null);
    } else {
      window.location.href = window.location.origin;
    }
  }, [onPlay]);

  // Get current segment by integer index
  const currentSegment = hook.segments.find(s => s.index === selectedSegmentIndex) || null;

  // No level loaded yet
  if (!hook.isLoaded) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#fff',
      }}>
        <h2>Watershed Level Editor</h2>
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
          <button onClick={handleNew} style={toolbarButtonStyle}>
            New Level
          </button>
          <button onClick={handleLoadFile} style={toolbarButtonStyle}>
            Open File
          </button>
        </div>
      </div>
    );
  }

  const hasErrors = validationResult.errors.length > 0;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#0a0a0a',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Toolbar */}
      <Toolbar
        onSave={() => onSave?.(null)}
        onPlay={handlePlay}
        onExport={handleExport}
        onLoadFile={handleLoadFile}
        onNew={handleNew}
        hasErrors={hasErrors}
      />

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel: Segment Inspector */}
        <SegmentInspector
          segment={currentSegment}
          totalSegments={hook.segments.length}
          onChange={handleSegmentChange}
          onSelectSegment={setSelectedSegmentIndex}
          errors={validationResult.errors}
        />

        {/* Center: 3D Viewport */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Viewport controls */}
          <div style={{
            height: '36px',
            background: '#111',
            borderBottom: '1px solid #222',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: '8px',
          }}>
            {(['3d', 'top', 'side'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewportMode(mode)}
                style={{
                  padding: '4px 12px',
                  background: viewportMode === mode ? '#1a3a5a' : 'transparent',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  color: viewportMode === mode ? '#fff' : '#888',
                  fontSize: '11px',
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {mode}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#666' }}>
              {hook.levelName} • {hook.segments.length} segments
            </span>
          </div>

          {/* Canvas */}
          <div style={{ flex: 1 }}>
            <Canvas
              camera={{ 
                position: [50, 50, 50], 
                fov: 50,
                up: [0, 1, 0],
              }}
              gl={{ antialias: true }}
            >
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 20, 10]} intensity={1} />
              
              {/* Grid */}
              <Grid
                position={[0, -5, 0]}
                args={[200, 200]}
                cellSize={10}
                cellThickness={0.5}
                cellColor="#333"
                sectionSize={50}
                sectionThickness={1}
                sectionColor="#444"
                fadeDistance={400}
                fadeStrength={1}
                infiniteGrid
              />

              {/* Path visualization */}
              <PathVisualizer
                waypoints={hook.waypoints}
                segments={hook.segments}
                selectedSegment={selectedSegmentIndex}
                onSelectSegment={setSelectedSegmentIndex}
              />

              {/* Camera controls */}
              <OrbitControls
                enablePan={true}
                enableZoom={true}
                enableRotate={viewportMode === '3d'}
                minDistance={10}
                maxDistance={300}
              />
            </Canvas>
          </div>

          {/* Bottom panel: Errors */}
          {showErrors && (
            <div style={{
              height: '200px',
              background: '#0a0a0a',
              borderTop: '1px solid #222',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '32px',
                background: '#111',
                borderBottom: '1px solid #222',
                display: 'flex',
                alignItems: 'center',
                padding: '0 16px',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '12px', fontWeight: 600 }}>Validation</span>
                <button
                  onClick={() => setShowErrors(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#666',
                    cursor: 'pointer',
                    fontSize: '16px',
                  }}
                >
                  ×
                </button>
              </div>
              <ErrorPanel
                errors={validationResult.errors}
                warnings={validationResult.warnings}
                onNavigateToField={handleNavigateToField}
              />
            </div>
          )}
        </div>

        {/* Right panel: Biome Selector */}
        <BiomeSelector
          selectedBiome={hook.worldBiome}
          onSelect={handleBiomeChange}
          onApplyToAll={handleApplyBiomeToAll}
          onApplyToSegment={handleApplyBiomeToSegment}
        />
      </div>

      {/* Export JSON modal */}
      {exportJson !== null && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: '8px',
            padding: '24px',
            width: '640px',
            maxWidth: '90vw',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#fff', fontSize: '16px' }}>Export JSON</h3>
              <button
                onClick={() => setExportJson(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: '20px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <textarea
              value={exportJson}
              readOnly
              style={{
                flex: 1,
                minHeight: '320px',
                background: '#0a0a0a',
                color: '#4ade80',
                border: '1px solid #333',
                borderRadius: '4px',
                padding: '12px',
                fontFamily: 'monospace',
                fontSize: '12px',
                resize: 'vertical',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => navigator.clipboard?.writeText(exportJson)}
                style={toolbarButtonStyle}
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setExportJson(null)}
                style={toolbarButtonStyle}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Create default level template
function createDefaultLevel(): any {
  return {
    metadata: {
      name: 'Untitled Level',
      author: 'Anonymous',
      difficulty: 'beginner',
      estimatedDuration: 120,
      version: '1.0.0',
    },
    world: {
      track: {
        waypoints: [
          [0, 0, 0],
          [0, -5, -50],
          [10, -10, -100],
          [-5, -15, -150],
        ],
        segmentLength: 30,
        totalSegments: 5,
        width: 35,
      },
      biome: {
        baseType: 'creek-summer',
        sky: { color: '#87CEEB', cloudDensity: 0.4 },
        fog: { color: '#D4E9F7', near: 50, far: 200 },
        lighting: { sunIntensity: 1.4, sunAngle: 45 },
        water: { tint: '#1a6b8a', flowSpeed: 1.0 },
      },
    },
    segments: Array.from({ length: 5 }, (_, i) => ({
      index: i,
      name: `Segment ${i + 1}`,
      type: 'normal',
      difficulty: 0.3,
      meanderStrength: 1.2,
      verticalBias: -0.5,
      forwardMomentum: 1.0,
      decorations: {
        trees: 10,
        grass: 20,
        rocks: 5,
      },
    })),
    spawns: {
      start: { position: [0, -4, 10], rotation: [0, 180, 0] },
      checkpoints: [],
    },
  };
}

export default LevelEditor;

