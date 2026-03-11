/**
 * Editor Entry Point
 * 
 * Standalone editor application for Watershed level authoring.
 * Run with: npm run editor
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { LevelEditor } from './components/LevelEditor';
import './style.css';

// Get initial level data from URL if provided
const getInitialLevel = () => {
  const params = new URLSearchParams(window.location.search);
  const levelParam = params.get('level');
  
  if (levelParam) {
    // Will be loaded by the editor
    return undefined;
  }
  
  return undefined;
};

const EditorApp: React.FC = () => {
  const handleSave = (levelData: any) => {
    // Download as JSON
    const blob = new Blob([JSON.stringify(levelData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${levelData.metadata.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePlay = (levelData: any) => {
    // Store in session and redirect to game
    sessionStorage.setItem('testLevel', JSON.stringify(levelData));
    window.location.href = '/?testLevel=true';
  };

  const handleExport = (levelData: any) => {
    // Copy to clipboard
    navigator.clipboard.writeText(JSON.stringify(levelData, null, 2));
    alert('Level JSON copied to clipboard!');
  };

  return (
    <LevelEditor
      initialLevelData={getInitialLevel()}
      onSave={handleSave}
      onPlay={handlePlay}
      onExport={handleExport}
    />
  );
};

// Mount the editor
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<EditorApp />);
}

export default EditorApp;
