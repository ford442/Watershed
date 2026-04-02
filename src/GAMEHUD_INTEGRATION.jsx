// GameHUD Integration Guide
// Add speedometer, distance, and wipeout to your scene

import { useRef, useState, useEffect } from 'react';
import { RigidBody } from '@react-three/rapier';
import FlowingWater from './components/FlowingWater';
import GameHUD from './components/GameHUD';
import ShaderBrowserPanel from './components/ShaderBrowserPanel';

function GameScene() {
  const raftRigidBodyRef = useRef(null);
  const [isWipeout, setIsWipeout] = useState(false);
  const [shaderBrowserOpen, setShaderBrowserOpen] = useState(false);
  const [currentShaderId, setCurrentShaderId] = useState('water-test-v1');

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Shader browser: Tab or P
      if ((e.key === 'Tab' || e.key.toLowerCase() === 'p') && !isWipeout) {
        e.preventDefault();
        setShaderBrowserOpen(prev => !prev);
      }
      
      // Respawn: Space when wiped out
      if (e.key === ' ' && isWipeout) {
        e.preventDefault();
        handleRespawn();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isWipeout]);

  // Listen for shader hot-swap
  useEffect(() => {
    const handleSwap = (e: CustomEvent) => {
      setCurrentShaderId(e.detail.shaderId);
    };
    window.addEventListener('watershed:swapShader', handleSwap as EventListener);
    return () => window.removeEventListener('watershed:swapShader', handleSwap as EventListener);
  }, []);

  // Check for wipeout conditions (falling off world, etc.)
  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (!raftRigidBodyRef.current || isWipeout) return;
      
      const pos = raftRigidBodyRef.current.translation();
      
      // Wipeout if: fell too low, flipped over, or went too far off-track
      if (pos.y < -15) { // Fell off the world
        setIsWipeout(true);
      }
      // Add more conditions as needed:
      // - If raft flips (check rotation)
      // - If hits obstacle at high speed
      // - If goes too far off the river path
    }, 500);

    return () => clearInterval(checkInterval);
  }, [isWipeout]);

  const handleRespawn = () => {
    if (!raftRigidBodyRef.current) return;
    
    // Reset position to start of current segment
    raftRigidBodyRef.current.setTranslation({ x: 0, y: 1, z: 0 }, true);
    raftRigidBodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    raftRigidBodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    
    setIsWipeout(false);
  };

  return (
    <>
      {/* Game world */}
      <RigidBody
        ref={raftRigidBodyRef}
        type="dynamic"
        colliders="hull"
        mass={10}
      >
        <FlowingWater shaderId={currentShaderId} ... />
        {/* ... raft mesh ... */}
      </RigidBody>

      {/* HUD Overlay */}
      <GameHUD
        rigidBodyRef={raftRigidBodyRef}
        isWipeout={isWipeout}
        onRespawn={handleRespawn}
      />

      {/* Shader Browser (hidden when wiped out) */}
      {!isWipeout && (
        <ShaderBrowserPanel
          isOpen={shaderBrowserOpen}
          onClose={() => setShaderBrowserOpen(false)}
        />
      )}
    </>
  );
}

/*
================================================================
WIPEOUT CONDITIONS (extend as needed)
================================================================

Add these checks to your useEffect interval:

// Flipped over
const rotation = raftRigidBodyRef.current.rotation();
if (Math.abs(rotation.x) > 2 || Math.abs(rotation.z) > 2) {
  setIsWipeout(true);
}

// High-speed collision
const vel = raftRigidBodyRef.current.linvel();
const speed = Math.sqrt(vel.x**2 + vel.y**2 + vel.z**2);
if (collisionForce > 50 && speed > 10) {
  setIsWipeout(true);
}

// Too far from river center
const riverCenter = getRiverCenterAtZ(pos.z);
if (Math.abs(pos.x - riverCenter) > 20) {
  setIsWipeout(true);
}

================================================================
TUNING THE SPEEDOMETER
================================================================

In GameHUD.tsx, adjust the multiplier:

const kmh = Math.round(rawSpeed * 12); // ← Change 12 to taste

Values to try:
- 8 = Realistic (slow feel)
- 12 = Balanced (default)
- 16 = Arcade (fast, exciting numbers)
- 20 = Extreme (always 80+ km/h)

================================================================
CSS REQUIREMENTS
================================================================

GameHUD uses Tailwind classes. If you don't use Tailwind,
add this to your global CSS:

.fixed { position: fixed; }
.inset-0 { inset: 0; }
.z-50 { z-index: 50; }
/* etc... or include Tailwind in your build */

================================================================
DEPLOY CHECKLIST
================================================================

1. Copy GameHUD.tsx to src/components/
2. Integrate into your scene (see example above)
3. Test wipeout by driving off the map
4. Verify respawn works
5. Check that best distance saves to localStorage

================================================================
*/
