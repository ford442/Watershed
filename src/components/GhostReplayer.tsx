import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../systems/GameState';
import { getRunGhostData } from '../systems/PersistenceSystem';
import { getActiveRunKey } from '../utils/runContext';
import {
  getGhostDurationSec,
  interpolateGhost,
  loadGhostFromBase64,
  type GhostPose,
} from '../systems/ghostPlayback';
import type { DecodedGhost } from '../systems/ghostCodec';

interface GhostReplayerProps {
  runKey?: string;
}

/**
 * Translucent, non-colliding runner silhouette replaying the saved best-run ghost.
 * Kinematic only — no physics body.
 */
export default function GhostReplayer({ runKey }: GhostReplayerProps) {
  const ghostEnabled = useGameStore((s) => s.ghostEnabled);
  const isPaused = useGameStore((s) => s.isPaused);
  const isWipeout = useGameStore((s) => s.isWipeout);
  const groupRef = useRef<THREE.Group>(null);
  const ghostRef = useRef<DecodedGhost | null>(null);
  const playbackTimeRef = useRef(0);
  const poseRef = useRef<GhostPose>({ px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 });
  const effectiveRunKey = runKey ?? getActiveRunKey();
  const [hasGhost, setHasGhost] = useState(false);

  useEffect(() => {
    const payload = getRunGhostData(effectiveRunKey);
    const decoded = loadGhostFromBase64(payload);
    ghostRef.current = decoded;
    playbackTimeRef.current = 0;
    setHasGhost(!!decoded && decoded.sampleCount > 0);
  }, [effectiveRunKey]);

  useEffect(() => {
    const onRunReset = () => {
      playbackTimeRef.current = 0;
    };
    window.addEventListener('watershed-run-reset', onRunReset);
    return () => window.removeEventListener('watershed-run-reset', onRunReset);
  }, []);

  useFrame((_, delta) => {
    const ghost = ghostRef.current;
    const group = groupRef.current;
    if (!ghostEnabled || isPaused || isWipeout || !ghost || !group || ghost.sampleCount <= 0) {
      return;
    }

    playbackTimeRef.current += delta;
    const duration = getGhostDurationSec(ghost);
    if (playbackTimeRef.current > duration) {
      playbackTimeRef.current = duration;
    }

    const pose = interpolateGhost(ghost, playbackTimeRef.current, poseRef.current);
    if (!pose) return;

    group.position.set(pose.px, pose.py, pose.pz);
    group.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  });

  if (!ghostEnabled || !hasGhost) {
    return null;
  }

  return (
    <group ref={groupRef}>
      <mesh castShadow={false} receiveShadow={false}>
        <capsuleGeometry args={[0.35, 0.9, 6, 10]} />
        <meshStandardMaterial
          color="#7ec8ff"
          transparent
          opacity={0.32}
          depthWrite={false}
          emissive="#224466"
          emissiveIntensity={0.35}
          roughness={0.85}
          metalness={0.05}
        />
      </mesh>
    </group>
  );
}
