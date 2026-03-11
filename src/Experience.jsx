import { PointerLockControls, KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import React, { useState, useRef, useEffect, useMemo } from "react";
import TrackManager from "./components/TrackManager";
import EnhancedSky from "./components/EnhancedSky";

// NEW: Import vehicle system
import { VehicleType } from "./systems/VehicleSystem";
import RunnerVehicle from "./vehicles/RunnerVehicle";
import RaftVehicle from "./vehicles/RaftVehicle";

// NEW: Import LevelLoader for custom maps
import LevelLoader, { ErrorDisplay, LoadingDisplay } from "./systems/LevelLoader";

const BIOME_LIGHTING = {
  summer: {
    ambientIntensity: 0.40,       // Slightly reduced to let directional light pop more
    hemiSky: '#9ad0f0',           // Cooler blue-white, closer to water/fog palette
    hemiGround: '#3a3828',        // Warmer ground bounce for wet-rock look
    hemiIntensity: 0.85,
    dirColor: '#fff4e0',          // Warm sunlight, slightly less yellow
    dirIntensity: 1.4,            // Stronger key light for sharper canyon shadows
    dirPosition: [12, 35, 18],    // Higher sun for better canyon illumination
    fillColor: '#a0c4e8',         // Cool-blue fill matching water tones
    fillIntensity: 0.22,
  },
  autumn: {
    ambientIntensity: 0.32,       // Slightly darker mood
    hemiSky: '#e8c070',           // Muted gold, less saturated
    hemiGround: '#382818',        // Deeper earthy ground bounce
    hemiIntensity: 0.65,
    dirColor: '#ffa040',          // Warm amber key
    dirIntensity: 1.1,            // Slightly stronger for better readability
    dirPosition: [30, 22, 12],    // Small lift for better reach into canyon
    fillColor: '#ffc888',         // Warm fill, less intense
    fillIntensity: 0.18,
  },
};

/**
 * Experience Component
 * 
 * Main game scene that handles:
 * - Level loading (from URL params or default)
 * - Biome switching
 * - Vehicle selection
 * - Physics and controls
 */
const Experience = () => {
  const [biome, setBiome] = useState('summer');
  const [vehicleType, setVehicleType] = useState('runner');
  const vehicleRef = useRef(null);
  
  // NEW: Level loading state
  const [levelUrl, setLevelUrl] = useState(null);
  const [levelLoadError, setLevelLoadError] = useState(null);
  const [isLoadingLevel, setIsLoadingLevel] = useState(false);
  const [loadedLevelState, setLoadedLevelState] = useState(null);
  
  // Check for level URL parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const levelParam = params.get('level');
    const levelUrlParam = params.get('levelUrl');
    
    if (levelParam) {
      // Load from public/levels/ directory
      setLevelUrl(`./levels/${levelParam}`);
      setIsLoadingLevel(true);
    } else if (levelUrlParam) {
      // Load from custom URL
      setLevelUrl(levelUrlParam);
      setIsLoadingLevel(true);
    }
  }, []);
  
  // Apply biome from loaded level
  const handleLevelLoad = useCallback((levelState) => {
    setLoadedLevelState(levelState);
    setIsLoadingLevel(false);
    
    // Set initial biome from level
    if (levelState?.biome?.baseType) {
      const biomeMap = {
        'creek-summer': 'summer',
        'creek-autumn': 'autumn',
        'alpine-spring': 'summer',
        'canyon-sunset': 'autumn',
        'midnight-mist': 'autumn',
      };
      const newBiome = biomeMap[levelState.biome.baseType] || 'summer';
      setBiome(newBiome);
    }
  }, []);
  
  const handleLevelError = useCallback((error) => {
    setLevelLoadError(error);
    setIsLoadingLevel(false);
  }, []);

  const L = BIOME_LIGHTING[biome] || BIOME_LIGHTING.summer;
  
  // Use level lighting if available
  const lightingConfig = useMemo(() => {
    if (loadedLevelState?.biome?.lighting) {
      const levelLighting = loadedLevelState.biome.lighting;
      return {
        ambientIntensity: levelLighting.ambientIntensity ?? L.ambientIntensity,
        hemiSky: loadedLevelState.biome.sky?.color ?? L.hemiSky,
        hemiGround: L.hemiGround,
        hemiIntensity: 0.85,
        dirColor: levelLighting.sunColor ?? L.dirColor,
        dirIntensity: levelLighting.sunIntensity ?? L.dirIntensity,
        dirPosition: L.dirPosition,
        fillColor: L.fillColor,
        fillIntensity: L.fillIntensity,
      };
    }
    return L;
  }, [loadedLevelState, L]);

  return (
    <KeyboardControls
      map={[
        { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
        { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
        { name: 'leftward', keys: ['ArrowLeft', 'KeyA'] },
        { name: 'rightward', keys: ['ArrowRight', 'KeyD'] },
        { name: 'jump', keys: ['Space'] },
      ]}
    >
      {/* Sky and environment - use level biome if available */}
      <EnhancedSky biome={biome} />
      
      {/* Lighting - biome responsive */}
      <ambientLight intensity={lightingConfig.ambientIntensity} />
      <hemisphereLight 
        skyColor={lightingConfig.hemiSky}
        groundColor={lightingConfig.hemiGround}
        intensity={lightingConfig.hemiIntensity}
      />
      <directionalLight 
        color={lightingConfig.dirColor}
        position={lightingConfig.dirPosition}
        intensity={lightingConfig.dirIntensity}
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      {/* Soft fill light from opposite side to reduce harsh shadows */}
      <directionalLight
        color={lightingConfig.fillColor}
        position={[-10, 15, -20]}
        intensity={lightingConfig.fillIntensity}
      />
      
      {/* Physics world */}
      <Physics gravity={[0, -20, 0]}>
        {/* First-person controls */}
        <PointerLockControls 
          makeDefault 
          lockOnClick
          onLock={() => {/* console.log("Locked—WASD to slide, SPACE to jump!") */}} 
        />
        
        {/* Vehicle - ONE LINE SWAP */}
        {vehicleType === 'runner' ? (
          <RunnerVehicle ref={vehicleRef} />
        ) : (
          <RaftVehicle ref={vehicleRef} />
        )}
        
        {/* Track Generation with Level Loading Support */}
        {levelUrl ? (
          // Load custom level from URL
          <LevelLoader
            levelUrl={levelUrl}
            onLoad={handleLevelLoad}
            onError={handleLevelError}
            showLoader={false}
            raftRef={vehicleRef}
            onBiomeChange={setBiome}
          />
        ) : (
          // Default procedural generation
          <TrackManager onBiomeChange={setBiome} raftRef={vehicleRef} />
        )}
      </Physics>
      
      {/* Loading overlay */}
      {isLoadingLevel && (
        <LoadingDisplay message="Loading custom level..." />
      )}
      
      {/* Error overlay */}
      {levelLoadError && (
        <ErrorDisplay 
          error={levelLoadError}
          onDismiss={() => setLevelLoadError(null)}
          onRetry={() => {
            setLevelLoadError(null);
            setIsLoadingLevel(true);
            // Trigger reload by clearing and resetting
            setLoadedLevelState(null);
          }}
        />
      )}
    </KeyboardControls>
  );
};

export default Experience;
