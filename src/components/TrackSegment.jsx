import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import { useTexture } from '@react-three/drei';
import FlowingWater from './FlowingWater';
import Rock from './Obstacles/Rock';
import Vegetation from './Environment/Vegetation';
import Grass from './Environment/Grass';
import FloatingDebris from './Environment/FloatingDebris';
import Driftwood from './Environment/Driftwood';

// Simple seeded random function
const seededRandom = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

// Default points to keep hooks happy when inactive
const DEFAULT_POINTS = [new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1)];

/**
 * TrackSegment - A single segment of the river track
 * Generates an organic canyon shape using procedural noise and heightmaps,
 * deformed along a spline path.
 * 
 * @param {THREE.Vector3[]} pathPoints - Array of Vector3 points defining the spline path
 * @param {number} segmentId - Unique identifier for this segment
 * @param {boolean} active - Whether this segment is currently active/visible
 */
export default function TrackSegment({ pathPoints, segmentId = 0, active = true }) {
    // Load Textures from public folder
    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach(t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(4, 8); // Increased repeat for larger surface area
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // Create the custom Wet Rock Material
    // This uses Vertex Colors to drive both Diffuse Darkening (Wetness) and Roughness
    const rockMaterial = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            map: colorMap,
            normalMap: normalMap,
            roughnessMap: roughnessMap,
            aoMap: aoMap,
            side: THREE.DoubleSide,
            vertexColors: true, // IMPORTANT: Enable vertex colors for wetness effect
        });

        mat.onBeforeCompile = (shader) => {
            // Modify fragment shader to link roughness to vertex color intensity
            // vColor.r comes from our geometry generation:
            // Low value (dark) = Wet = Should be shiny (low roughness)
            // High value (bright) = Dry = Should be rough

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                #include <roughnessmap_fragment>

                // PALETTE: Wet Rock Logic
                // We use the red channel of vertex color as "dryness" factor (0.0 = soaked, 1.0 = dry)
                // vColor is automatically available when vertexColors=true

                float dryness = smoothstep(0.4, 0.8, vColor.r);

                // Mix roughness:
                // If wet (dryness -> 0), use low roughness (0.15) for shiny look
                // If dry (dryness -> 1), use original map value

                roughnessFactor = mix(0.15, roughnessFactor, dryness);
                `
            );
        };

        return mat;
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // Use safe points if inactive or points are missing
    const safePoints = (active && pathPoints && pathPoints.length > 0) ? pathPoints : DEFAULT_POINTS;

    // Create the spline path from provided points
    const segmentPath = useMemo(() => {
        if (!active) return null;
        return new THREE.CatmullRomCurve3(safePoints, false, 'catmullrom', 0.5);
    }, [safePoints, active]);

    // Calculate path length for proper sizing
    const pathLength = useMemo(() => {
        return segmentPath ? segmentPath.getLength() : 1;
    }, [segmentPath]);

    // Canyon dimensions
    const canyonWidth = 35; // Wide enough to include walls
    const waterLevel = 0.5; // Relative to the riverbed center

    // Derived Placement Data
    const placementData = useMemo(() => {
        if (!segmentPath) return { rocks: [], trees: [], debris: [], grass: [], driftwood: [], walls: [] };

        const rocks = [];
        const trees = [];
        const debris = [];
        const grass = [];
        const driftwood = [];

        let seed = segmentId * 1000; // Base seed

        const geoWidth = canyonWidth;
        const geoLength = pathLength;

        // Iterate through simplified grid for placement
        // We don't need to match vertex count exactly, just sample the space
        const zSteps = 20; // Number of longitudinal slices to check

        for(let z = 0; z < zSteps; z++) {
            const t = z / zSteps;
            // Map t back to local Z range [-length/2, length/2] for noise calc
            const zLocal = (t - 0.5) * geoLength;

            // Get path properties at this point
            const pathPoint = segmentPath.getPoint(t);
            const tangent = segmentPath.getTangent(t).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

            // Check left and right banks
            const sides = [-1, 1];
            
            // Process each side
            for (let sideIdx = 0; sideIdx < sides.length; sideIdx++) {
                const side = sides[sideIdx];
                // Determine randomized offset from center
                // Rocks closer (5-10), Trees farther (10-15)

                // Sample 1: Rocks
                if (seededRandom(seed++) > 0.4) { // 60% chance per slice/side
                    const dist = 6 + seededRandom(seed++) * 4; // 6 to 10
                    // Offset perpendicular to path
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist; // Keep local X for noise consistency

                    // Calc height at this spot (reusing logic from geometry)
                    const normalizedDist = Math.abs(xLocal) / (geoWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < 5) yHeight *= 0.1;

                    const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 +
                                      Math.sin(zLocal * 1.5 - xLocal * 0.8) * 0.2;
                    yHeight += rockNoise * (0.5 + normalizedDist);

                    if (Math.abs(xLocal) > 5) {
                         const hillNoise = Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;
                         yHeight += hillNoise;
                    }

                    // Map to world using binormal offset
                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    // Add some random rotation/scale
                    const rotation = new THREE.Euler(
                        seededRandom(seed++) * Math.PI,
                        seededRandom(seed++) * Math.PI,
                        seededRandom(seed++) * Math.PI
                    );
                    const scale = 0.8 + seededRandom(seed++) * 0.8;

                    rocks.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // Sample 2: Trees (Higher up/further out)
                if (seededRandom(seed++) > 0.7) { // 30% chance
                    const dist = 12 + seededRandom(seed++) * 5; // 12 to 17
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    // Height calc (simplified reuse)
                    const normalizedDist = Math.abs(xLocal) / (geoWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    // ... simplify noise for tree placement height
                     const hillNoise = Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;
                     yHeight += hillNoise;

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight - 0.5; // Embed slightly

                    const scale = 1.5 + seededRandom(seed++) * 1.0;
                    const rotation = new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0);

                    trees.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // Sample 3: Debris (Near water edge)
                 if (seededRandom(seed++) > 0.5) {
                    const dist = 5 + seededRandom(seed++) * 2; // 5 to 7
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;
                    const normalizedDist = Math.abs(xLocal) / (geoWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < 5) yHeight *= 0.1;

                     const position = new THREE.Vector3().copy(pathPoint).add(offset);
                     position.y += yHeight;

                    const scale = 0.2 + seededRandom(seed++) * 0.3;
                    const rotation = new THREE.Euler(
                        seededRandom(seed++) * Math.PI,
                        seededRandom(seed++) * Math.PI,
                        seededRandom(seed++) * Math.PI
                    );

                    debris.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                 }

                 // Sample 4: Grass/Bushes (Banks and gaps)
                 // Higher density than trees/rocks
                 if (seededRandom(seed++) > 0.3) {
                    const dist = 6 + seededRandom(seed++) * 8; // 6 to 14 (spread across banks)
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    const normalizedDist = Math.abs(xLocal) / (geoWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < 5) yHeight *= 0.1;

                    // Add some noise to height so they sit naturally on rough terrain
                    const groundNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 +
                                        Math.sin(zLocal * 1.5 - xLocal * 0.8) * 0.2;
                    yHeight += groundNoise * (0.5 + normalizedDist);

                     const position = new THREE.Vector3().copy(pathPoint).add(offset);
                     position.y += yHeight;

                    const scale = 0.4 + seededRandom(seed++) * 0.4;
                    const rotation = new THREE.Euler(
                        0, // Mostly upright
                        seededRandom(seed++) * Math.PI * 2,
                        (seededRandom(seed++) - 0.5) * 0.2 // Slight tilt
                    );

                    grass.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                 }

                 // Sample 5: Driftwood (Water edge / Banks)
                 // Increased density for "Palette" visual upgrade
                 if (seededRandom(seed++) > 0.4) { // Increased from 20% to 60% chance
                    // Place near water edge (approx 4-6 units from center)
                    const dist = 4.5 + seededRandom(seed++) * 2.5;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    const normalizedDist = Math.abs(xLocal) / (geoWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < 5) yHeight *= 0.1;

                    // Embed in ground slightly
                    yHeight -= 0.2;

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scaleY = 0.8 + seededRandom(seed++) * 0.5; // Length
                    const scaleXZ = 0.6 + seededRandom(seed++) * 0.4; // Thickness

                    const rotation = new THREE.Euler(
                        seededRandom(seed++) * Math.PI * 0.2, // Slight tilt
                        seededRandom(seed++) * Math.PI * 2,   // Random yaw
                        seededRandom(seed++) * Math.PI * 0.2  // Slight roll
                    );

                    driftwood.push({
                        position,
                        rotation,
                        scale: new THREE.Vector3(scaleXZ, scaleY, scaleXZ)
                    });
                 }
            }
        }

        // Fix Driftwood Scaling because geometry is X-aligned
        const correctedDriftwood = driftwood.map(d => {
             const length = 0.8 + seededRandom(seed++) * 0.8;
             const thickness = 0.5 + seededRandom(seed++) * 0.5;
             return {
                 ...d,
                 scale: new THREE.Vector3(length, thickness, thickness)
             };
        });

        return { rocks, trees, debris, grass, driftwood: correctedDriftwood };
    }, [segmentPath, pathLength, segmentId]);


    // Generate unified canyon geometry (Walls + Floor)
    const canyonGeometry = useMemo(() => {
        if (!segmentPath) return null;

        // High resolution for noise details
        // width segments: 30, height segments (length): based on length/2
        const segmentsX = 40;
        const segmentsZ = Math.floor(pathLength);

        const geo = new THREE.PlaneGeometry(canyonWidth, pathLength, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2); // Lay flat: X=Width, Y=Up, Z=Length
        
        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();

        // Add Vertex Colors buffer
        const colors = new Float32Array(positions.count * 3);
        const color = new THREE.Color();

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            
            // 1. Calculate Local Organic Shape (CreekCanyon logic)
            const xLocal = vertex.x; // Distance from center
            const zLocal = vertex.z;

            const distFromCenter = Math.abs(xLocal);
            const normalizedDist = distFromCenter / (canyonWidth * 0.45); // Normalize, keeping some margin

            // Canyon shape: Power curve for steep walls
            // Using logic from CreekCanyon.jsx: y = Math.pow(normalizedDist, 2.5) * 12
            let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;

            // Clamp the center to be relatively flat for the riverbed (width ~10)
            // If dist < 4, keep it flatter
            if (distFromCenter < 5) {
                yHeight *= 0.1; // Flatten the bottom
            }

            // Add rocky texture variation (Simplex-like using sin/cos)
            const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 +
                              Math.sin(zLocal * 1.5 - xLocal * 0.8) * 0.2 +
                              Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
            
            yHeight += rockNoise * (0.5 + normalizedDist);
            
            // Add larger "Hill" noise on the walls
            if (distFromCenter > 5) {
                 const hillNoise = Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;
                 yHeight += hillNoise;
            }

            // 2. Map to Spline
            const t = (zLocal + pathLength / 2) / pathLength;
            const clampedT = Math.max(0, Math.min(1, t));
            
            const point = segmentPath.getPoint(clampedT);
            
            // Apply Wet Rock Coloring
            // Determine how "wet" this vertex is based on yHeight (height above riverbed)
            // Water is at ~0.5 height relative to bottom.
            // Wet zone extends slightly above water level due to splash/capillary action.

            // dryness: 0 (Wet) -> 1 (Dry)
            // yHeight < 0.5 is underwater (Darkest)
            // yHeight 0.5 - 2.5 transitions to dry
            const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2) / 2.5));

            // Darken the color based on dryness
            // Wet (0) -> 0.4 intensity
            // Dry (1) -> 1.0 intensity
            const intensity = 0.4 + 0.6 * dryness;

            color.setScalar(intensity);

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight);
            positions.setZ(i, point.z); // Z is largely driven by the spline point
        }
        
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength]);

    // Generate Visual Shell for Higher Walls
    const wallShellGeometry = useMemo(() => {
        if (!segmentPath) return null;

        // Similar to canyonGeometry but wider and higher
        const shellWidth = canyonWidth * 1.5;
        const segmentsX = 20;
        const segmentsZ = Math.floor(pathLength / 2);

        const geo = new THREE.PlaneGeometry(shellWidth, pathLength, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;

            // Simple wall shape
            const distFromCenter = Math.abs(xLocal);
            // Only care about outer walls
            let yHeight = Math.pow(distFromCenter / 8, 3) * 5;
            yHeight += Math.sin(zLocal * 0.1) * 2; // Add some noise

            const t = (zLocal + pathLength / 2) / pathLength;
            const clampedT = Math.max(0, Math.min(1, t));
            const point = segmentPath.getPoint(clampedT);

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight - 2); // Overlap slightly
            positions.setZ(i, point.z);
        }

        geo.computeVertexNormals();
        return geo;

    }, [segmentPath, pathLength]);

    // Generate water geometry
    const waterGeometry = useMemo(() => {
        if (!segmentPath) return null;

        // Water is narrower than full canyon
        const waterWidth = 10;
        const segmentsZ = Math.floor(pathLength / 2); // Lower res than rock

        const geo = new THREE.PlaneGeometry(waterWidth, pathLength, 4, segmentsZ);
        geo.rotateX(-Math.PI / 2);
        
        const positions = geo.attributes.position;

        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            
            const t = (z + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            positions.setX(i, point.x + x);
            positions.setY(i, point.y + waterLevel);
            positions.setZ(i, point.z);
        }
        
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength]);

    // Calculate stream start position and direction for floating debris
    const streamData = useMemo(() => {
        if (!segmentPath) return null;
        
        const startPoint = segmentPath.getPoint(0);
        const tangent = segmentPath.getTangent(0).normalize();
        
        return {
            start: startPoint,
            direction: tangent,
            length: pathLength
        };
    }, [segmentPath, pathLength]);

    // If inactive or missing data, render nothing
    if (!active || !segmentPath || !canyonGeometry || !waterGeometry) {
        return null;
    }

    return (
        <group name={`track-segment-${segmentId}`}>
            {/* Unified Canyon Terrain */}
            <RigidBody type="fixed" colliders="trimesh" friction={1} restitution={0.1}>
                <mesh geometry={canyonGeometry} receiveShadow castShadow material={rockMaterial} />
            </RigidBody>

            {/* Visual Wall Shell (No Physics) */}
            <mesh geometry={wallShellGeometry} receiveShadow castShadow material={rockMaterial} />

            {/* Rocks */}
            <Rock transforms={placementData.rocks} />

            {/* Debris (Small Rocks) */}
            <Rock transforms={placementData.debris} />

            {/* Vegetation */}
            <Vegetation transforms={placementData.trees} />

            {/* Grass / Bushes */}
            <Grass transforms={placementData.grass} />

            {/* Driftwood */}
            <Driftwood transforms={placementData.driftwood} />

            {/* Water Surface */}
            <FlowingWater 
                geometry={waterGeometry}
                flowSpeed={1.5}
                baseColor="#1a6b8a"
                foamColor="#e8f4f8"
            />
            
            {/* Floating Pinecones */}
            {streamData && (
                <FloatingDebris
                    streamStart={streamData.start}
                    streamDirection={streamData.direction}
                    streamLength={streamData.length}
                    waterLevel={waterLevel}
                    count={6}
                    seed={segmentId * 1000}
                />
            )}
        </group>
    );
}
