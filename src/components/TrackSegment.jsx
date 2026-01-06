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

const seededRandom = (seed) => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
};

const DEFAULT_POINTS = [new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1)];

export default function TrackSegment({
    pathPoints,
    segmentId = 0,
    active = true,
    type = 'normal',   // 'normal', 'waterfall', 'pond'
    biome = 'summer'   // 'summer', 'autumn'
}) {
    // Load Textures
    const [colorMap, normalMap, roughnessMap, aoMap] = useTexture([
        './Rock031_1K-JPG_Color.jpg',
        './Rock031_1K-JPG_NormalGL.jpg',
        './Rock031_1K-JPG_Roughness.jpg',
        './Rock031_1K-JPG_AmbientOcclusion.jpg',
    ]);

    useEffect(() => {
        [colorMap, normalMap, roughnessMap, aoMap].forEach(t => {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(4, 8);
        });
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    // Wet Rock Material
    const rockMaterial = useMemo(() => {
        const mat = new THREE.MeshStandardMaterial({
            map: colorMap,
            normalMap: normalMap,
            roughnessMap: roughnessMap,
            aoMap: aoMap,
            side: THREE.DoubleSide,
            vertexColors: true,
        });

        mat.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                #include <roughnessmap_fragment>
                float dryness = smoothstep(0.4, 0.8, vColor.r);
                roughnessFactor = mix(0.15, roughnessFactor, dryness);
                `
            );
        };
        return mat;
    }, [colorMap, normalMap, roughnessMap, aoMap]);

    const safePoints = (active && pathPoints && pathPoints.length > 0) ? pathPoints : DEFAULT_POINTS;

    // Spline Path
    const segmentPath = useMemo(() => {
        if (!active) return null;
        // Ponds use lower tension for smoother, wider curves
        const tension = type === 'pond' ? 0.2 : 0.5;
        return new THREE.CatmullRomCurve3(safePoints, false, 'catmullrom', tension);
    }, [safePoints, active, type]);

    const pathLength = useMemo(() => {
        return segmentPath ? segmentPath.getLength() : 1;
    }, [segmentPath]);

    // --- Dynamic Dimensions based on Type ---
    const canyonWidth = type === 'pond' ? 80 : 35;
    const waterWidth  = type === 'pond' ? 50 : 10;
    const waterLevel  = 0.5;

    // Derived Placement Data
    const placementData = useMemo(() => {
        if (!segmentPath) return { rocks: [], trees: [], debris: [], grass: [], driftwood: [] };

        const rocks = [];
        const trees = [];
        const debris = [];
        const grass = [];
        const driftwood = [];

        let seed = segmentId * 1000;
        const geoLength = pathLength;
        const zSteps = Math.ceil(pathLength / 2); // Adaptive sampling

        // Helper to calculate bank positions relative to water width
        const bankStart = waterWidth / 2;

        for(let z = 0; z < zSteps; z++) {
            const t = z / zSteps;
            const zLocal = (t - 0.5) * geoLength;

            const pathPoint = segmentPath.getPoint(t);
            const tangent = segmentPath.getTangent(t).normalize();
            const up = new THREE.Vector3(0, 1, 0);
            const binormal = new THREE.Vector3().crossVectors(tangent, up).normalize();

            const sides = [-1, 1];
            
            for (let sideIdx = 0; sideIdx < sides.length; sideIdx++) {
                const side = sides[sideIdx];
                const isPond = type === 'pond';

                // 1. ROCKS (Large)
                const rockChance = isPond ? 0.3 : 0.4; // Less dense in ponds
                if (seededRandom(seed++) > (1.0 - rockChance)) {
                    // Place rocks starting from the water's edge + random offset
                    const dist = bankStart + 1 + seededRandom(seed++) * 4;

                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    // Height calculation
                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < bankStart + 2) yHeight *= 0.1;

                    // Variation
                    const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3;
                    yHeight += rockNoise * (0.5 + normalizedDist);

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scale = 0.8 + seededRandom(seed++) * 0.8;
                    const rotation = new THREE.Euler(
                        seededRandom(seed++)*Math.PI,
                        seededRandom(seed++)*Math.PI,
                        seededRandom(seed++)*Math.PI
                    );
                    rocks.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 2. TREES
                // Denser in Autumn or around Ponds
                const treeChance = (biome === 'autumn' || isPond) ? 0.6 : 0.3;
                if (seededRandom(seed++) > (1.0 - treeChance)) {
                    // Trees are further up the bank
                    const dist = bankStart + 5 + seededRandom(seed++) * 5;

                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    yHeight += Math.sin(zLocal * 0.15) * Math.cos(xLocal * 0.3) * 1.5;

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight - 0.5;

                    const scale = 1.5 + seededRandom(seed++) * 1.0;
                    const rotation = new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0);
                    trees.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 3. DEBRIS (Small Rocks)
                if (seededRandom(seed++) > 0.5) {
                    // Near water edge
                    const dist = bankStart + seededRandom(seed++) * 2;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < bankStart + 2) yHeight *= 0.1;

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scale = 0.2 + seededRandom(seed++) * 0.3;
                    const rotation = new THREE.Euler(seededRandom(seed++)*Math.PI, seededRandom(seed++)*Math.PI, seededRandom(seed++)*Math.PI);
                    debris.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 4. GRASS
                if (seededRandom(seed++) > 0.3) {
                    const dist = bankStart + 1 + seededRandom(seed++) * 8;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < bankStart + 2) yHeight *= 0.1;

                    // Ground noise
                    yHeight += (Math.sin(zLocal * 0.8) * 0.3) * (0.5 + normalizedDist);

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scale = 0.4 + seededRandom(seed++) * 0.4;
                    const rotation = new THREE.Euler(0, seededRandom(seed++) * Math.PI * 2, 0);
                    grass.push({ position, rotation, scale: new THREE.Vector3(scale, scale, scale) });
                }

                // 5. DRIFTWOOD
                if (seededRandom(seed++) > 0.4) {
                    // Water edge / slightly submerged
                    const dist = bankStart - 0.5 + seededRandom(seed++) * 2.5;
                    const offset = binormal.clone().multiplyScalar(side * dist);
                    const xLocal = side * dist;

                    const normalizedDist = Math.abs(xLocal) / (canyonWidth * 0.45);
                    let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;
                    if (Math.abs(xLocal) < bankStart + 2) yHeight *= 0.1;
                    yHeight -= 0.2;

                    const position = new THREE.Vector3().copy(pathPoint).add(offset);
                    position.y += yHeight;

                    const scaleY = 0.8 + seededRandom(seed++) * 0.5;
                    const scaleXZ = 0.6 + seededRandom(seed++) * 0.4;
                    const rotation = new THREE.Euler(
                        seededRandom(seed++) * 0.2,
                        seededRandom(seed++) * Math.PI * 2,
                        seededRandom(seed++) * 0.2
                    );
                    driftwood.push({ position, rotation, scale: new THREE.Vector3(scaleXZ, scaleY, scaleXZ) });
                }
            }
        }

        // Fix Driftwood Scaling
        const correctedDriftwood = driftwood.map(d => {
             const length = 0.8 + seededRandom(seed++) * 0.8;
             const thickness = 0.5 + seededRandom(seed++) * 0.5;
             return { ...d, scale: new THREE.Vector3(length, thickness, thickness) };
        });

        return { rocks, trees, debris, grass, driftwood: correctedDriftwood };
    }, [segmentPath, pathLength, segmentId, canyonWidth, waterWidth, type, biome]);

    // Canyon Geometry
    const canyonGeometry = useMemo(() => {
        if (!segmentPath) return null;
        const segmentsX = 40;
        const segmentsZ = Math.floor(pathLength);

        const geo = new THREE.PlaneGeometry(canyonWidth, pathLength, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);
        
        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        const colors = new Float32Array(positions.count * 3);
        const color = new THREE.Color();

        const flatBottomWidth = waterWidth; // Ensure riverbed is flat for the water

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);
            const normalizedDist = distFromCenter / (canyonWidth * 0.45);

            // Terrain shape
            let yHeight = Math.pow(Math.max(0, normalizedDist), 3.0) * 14;

            // Flatten bottom for riverbed/pond
            if (distFromCenter < flatBottomWidth / 2) {
                yHeight *= 0.1;
            }

            // Noise
            const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
            yHeight += rockNoise * (0.5 + normalizedDist);
            
            // Map to Spline
            const t = (zLocal + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));
            
            // Wetness/Coloring
            const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2) / 2.5));
            const intensity = 0.4 + 0.6 * dryness;
            color.setScalar(intensity);
            colors[i*3] = color.r; colors[i*3+1] = color.g; colors[i*3+2] = color.b;

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight);
            positions.setZ(i, point.z);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, canyonWidth, waterWidth]);

    // Wall Shell Geometry (Visual Only, Higher)
    const wallShellGeometry = useMemo(() => {
        if (!segmentPath) return null;
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
            const distFromCenter = Math.abs(xLocal);

            // Simple high wall shape
            let yHeight = Math.pow(distFromCenter / 8, 3) * 5;
            yHeight += Math.sin(zLocal * 0.1) * 2;

            const t = (zLocal + pathLength / 2) / pathLength;
            const point = segmentPath.getPoint(Math.max(0, Math.min(1, t)));

            positions.setX(i, point.x + xLocal);
            positions.setY(i, point.y + yHeight - 2);
            positions.setZ(i, point.z);
        }
        geo.computeVertexNormals();
        return geo;
    }, [segmentPath, pathLength, canyonWidth]);

    // Water Geometry
    const waterGeometry = useMemo(() => {
        if (!segmentPath) return null;
        const segmentsZ = Math.floor(pathLength / 2);
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
    }, [segmentPath, pathLength, waterWidth]);

    // Stream Data for Floating Debris
    const streamData = useMemo(() => {
        if (!segmentPath) return null;
        const startPoint = segmentPath.getPoint(0);
        const tangent = segmentPath.getTangent(0).normalize();
        return { start: startPoint, direction: tangent, length: pathLength };
    }, [segmentPath, pathLength]);

    if (!active || !segmentPath || !canyonGeometry || !waterGeometry) return null;

    return (
        <group name={`track-segment-${segmentId}`}>
            {/* Unified Canyon Terrain */}
            <RigidBody type="fixed" colliders="trimesh" friction={1} restitution={0.1}>
                <mesh geometry={canyonGeometry} receiveShadow castShadow material={rockMaterial} />
            </RigidBody>

            {/* Visual Wall Shell */}
            <mesh geometry={wallShellGeometry} receiveShadow castShadow material={rockMaterial} />

            {/* Environment Objects */}
            <Rock transforms={placementData.rocks} />
            <Rock transforms={placementData.debris} />
            <Vegetation transforms={placementData.trees} biome={biome} />
            <Grass transforms={placementData.grass} />
            <Driftwood transforms={placementData.driftwood} />

            {/* Water */}
            <FlowingWater 
                geometry={waterGeometry}
                flowSpeed={type === 'pond' ? 0.5 : 1.5}
                baseColor={type === 'pond' ? "#1a4b6a" : "#1a6b8a"}
            />
            
            {/* Floating Pinecones (Only if not a steep waterfall to prevent physics glitches) */}
            {streamData && type !== 'waterfall' && (
                <FloatingDebris
                    streamStart={streamData.start}
                    streamDirection={streamData.direction}
                    streamLength={streamData.length}
                    waterLevel={waterLevel}
                    count={type === 'pond' ? 12 : 6} // More debris in pond
                    seed={segmentId * 1000}
                />
            )}
        </group>
    );
}
