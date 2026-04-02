// ShaderBrowser Integration Guide
// Add in-game shader browser to your scene

import { useRef, useState, useEffect } from 'react';
import FlowingWater from './components/FlowingWater';
import ShaderBrowserPanel from './components/ShaderBrowserPanel';

function GameScene() {
  const waterMaterialRef = useRef(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [currentShaderId, setCurrentShaderId] = useState('water-test-v1');

  // Keyboard shortcut: Tab or P to toggle browser
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setBrowserOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Listen for hot-swap events from browser
  useEffect(() => {
    const handleSwap = (e: CustomEvent) => {
      const { shaderId } = e.detail;
      console.log('[GameScene] Hot-swapping to shader:', shaderId);
      setCurrentShaderId(shaderId);
    };

    window.addEventListener('watershed:swapShader', handleSwap as EventListener);
    return () => window.removeEventListener('watershed:swapShader', handleSwap as EventListener);
  }, []);

  return (
    <>
      {/* Your existing scene */}
      <FlowingWater
        ref={waterMaterialRef}
        shaderId={currentShaderId}
        // ... other props
      />

      {/* Shader Browser Panel */}
      <ShaderBrowserPanel
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
      />
    </>
  );
}

/*
================================================================
CSS STYLING (add to your global CSS if not using Tailwind)
================================================================

.shader-browser-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(8px);
}

.shader-browser-modal {
  background: #18181b;
  border: 1px solid #3f3f46;
  border-radius: 1rem;
  width: 100%;
  max-width: 72rem;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

================================================================
USAGE INSTRUCTIONS
================================================================

1. Copy files to your project:
   - src/hooks/useShaderBrowser.ts
   - src/components/ShaderBrowserPanel.tsx

2. Add to hooks/index.ts exports:
   export { useShaderBrowser } from './useShaderBrowser';

3. Integrate into your main scene (see example above)

4. Press Tab or P to open the browser mid-game

5. Click "Try Now" on any shader to hot-swap instantly

================================================================
BACKEND REQUIREMENTS
================================================================

Your FastAPI backend should support:

GET /api/shaders
Response: [
  {
    "id": "shader-id",
    "name": "Shader Name",
    "author": "Author Name",
    "description": "Description",
    "tags": ["tag1", "tag2"],
    "stars": 4.5,
    "rating_count": 123,
    "type": "fragment",
    "thumbnail": "optional-url"
  }
]

GET /api/shaders/{id}/code
Response: { "code": "shader source code" }

================================================================
*/
