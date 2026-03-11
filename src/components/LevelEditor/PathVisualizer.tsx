/**
 * Path Visualizer Component
 * 
 * Displays track waypoints as 3D line in the viewport with segment boundaries
 * and difficulty visualization.
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Line, Html } from '@react-three/drei';
import { SegmentConfig } from '../../hooks/useLevel';

interface PathVisualizerProps {
  waypoints: [number, number, number][];
  segments: SegmentConfig[];
  selectedSegment?: number;
  onSelectSegment?: (index: number) => void;
  showSegmentBoundaries?: boolean;
  showDifficultyGradient?: boolean;
}

// Get color for difficulty
const getDifficultyColor = (difficulty: number): string => {
  if (difficulty < 0.2) return '#4ade80'; // Green
  if (difficulty < 0.4) return '#a3e635'; // Light green
  if (difficulty < 0.6) return '#facc15'; // Yellow
  if (difficulty < 0.8) return '#fb923c'; // Orange
  return '#ef4444'; // Red
};

export const PathVisualizer: React.FC<PathVisualizerProps> = ({
  waypoints,
  segments,
  selectedSegment,
  onSelectSegment,
  showSegmentBoundaries = true,
  showDifficultyGradient = true,
}) => {
  // Create the main path curve
  const curve = useMemo(() => {
    const points = waypoints.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  }, [waypoints]);

  // Generate path points for line
  const pathPoints = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const divisions = 100;
    for (let i = 0; i <= divisions; i++) {
      points.push(curve.getPoint(i / divisions));
    }
    return points;
  }, [curve]);

  // Calculate segment boundary positions
  const segmentBoundaries = useMemo(() => {
    if (!showSegmentBoundaries || segments.length === 0) return [];
    
    const boundaries: Array<{ position: THREE.Vector3; index: number; difficulty: number }> = [];
    const totalSegments = segments.length;
    
    for (let i = 0; i <= totalSegments; i++) {
      const t = i / totalSegments;
      const point = curve.getPoint(Math.min(1, t));
      const segment = segments.find(s => s.index === i);
      boundaries.push({
        position: point,
        index: i,
        difficulty: segment?.difficulty ?? 0.5,
      });
    }
    
    return boundaries;
  }, [curve, segments, showSegmentBoundaries]);

  // Generate difficulty-colored segments
  const difficultySegments = useMemo(() => {
    if (!showDifficultyGradient || segments.length === 0) return [];
    
    const segLines: Array<{ points: THREE.Vector3[]; color: string }> = [];
    
    for (const segment of segments) {
      const tStart = segment.index / segments.length;
      const tEnd = (segment.index + 1) / segments.length;
      
      const points: THREE.Vector3[] = [];
      const divisions = 20;
      for (let i = 0; i <= divisions; i++) {
        const t = tStart + (tEnd - tStart) * (i / divisions);
        points.push(curve.getPoint(Math.min(1, t)));
      }
      
      segLines.push({
        points,
        color: getDifficultyColor(segment.difficulty),
      });
    }
    
    return segLines;
  }, [curve, segments, showDifficultyGradient]);

  return (
    <group name="path-visualizer">
      {/* Main path line */}
      <Line
        points={pathPoints}
        color="#4a9eff"
        lineWidth={2}
        dashed={false}
      />

      {/* Difficulty-colored segments */}
      {showDifficultyGradient && difficultySegments.map((seg, i) => (
        <Line
          key={`diff-${i}`}
          points={seg.points}
          color={seg.color}
          lineWidth={4}
          transparent
          opacity={0.6}
        />
      ))}

      {/* Waypoint markers */}
      {waypoints.map((wp, i) => (
        <group key={`wp-${i}`} position={[wp[0], wp[1], wp[2]]}>
          <mesh>
            <sphereGeometry args={[0.8, 16, 16]} />
            <meshBasicMaterial color={i === 0 ? '#4ade80' : i === waypoints.length - 1 ? '#ef4444' : '#4a9eff'} />
          </mesh>
          {/* Label */}
          <Html position={[0, 1.5, 0]} center>
            <div style={{
              color: 'white',
              fontSize: '12px',
              fontWeight: 'bold',
              textShadow: '0 0 4px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
            }}>
              WP{i}
            </div>
          </Html>
        </group>
      ))}

      {/* Segment boundary planes */}
      {showSegmentBoundaries && segmentBoundaries.map((boundary, i) => (
        <group key={`boundary-${i}`} position={boundary.position}>
          {/* Vertical plane marker */}
          <mesh rotation={[0, 0, 0]}>
            <planeGeometry args={[20, 15]} />
            <meshBasicMaterial 
              color={getDifficultyColor(boundary.difficulty)}
              transparent
              opacity={0.15}
              side={THREE.DoubleSide}
            />
          </mesh>
          
          {/* Selection highlight */}
          {selectedSegment === boundary.index && (
            <mesh rotation={[0, 0, 0]}>
              <planeGeometry args={[22, 17]} />
              <meshBasicMaterial 
                color="#ffffff"
                transparent
                opacity={0.3}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}

          {/* Boundary line */}
          <mesh rotation={[0, 0, 0]} position={[0, 0, 0]}>
            <planeGeometry args={[0.2, 15]} />
            <meshBasicMaterial 
              color={getDifficultyColor(boundary.difficulty)}
              transparent
              opacity={0.8}
            />
          </mesh>

          {/* Click target (invisible but clickable) */}
          <mesh 
            rotation={[0, 0, 0]}
            onClick={() => onSelectSegment?.(boundary.index)}
            visible={false}
          >
            <planeGeometry args={[25, 20]} />
            <meshBasicMaterial transparent opacity={0} />
          </mesh>

          {/* Segment label */}
          {i < segments.length && (
            <Html position={[0, 8, 0]} center>
              <div style={{
                background: '#1a1a1a',
                color: getDifficultyColor(boundary.difficulty),
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
              }}>
                Seg {i}
              </div>
            </Html>
          )}
        </group>
      ))}

      {/* Legend */}
      <group position={[
        waypoints[0][0] + 30,
        waypoints[0][1] + 10,
        waypoints[0][2]
      ]}>
        <Html center>
          <div style={{
            background: 'rgba(10, 10, 10, 0.9)',
            padding: '12px',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Difficulty</div>
            {[
              { label: 'Easy (0.0-0.2)', color: '#4ade80' },
              { label: 'Medium (0.4-0.6)', color: '#facc15' },
              { label: 'Hard (0.6-0.8)', color: '#fb923c' },
              { label: 'Extreme (0.8+)', color: '#ef4444' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ width: '12px', height: '12px', background: item.color, borderRadius: '2px' }} />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </Html>
      </group>
    </group>
  );
};

export default PathVisualizer;
