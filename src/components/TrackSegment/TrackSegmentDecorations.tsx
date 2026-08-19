import React from 'react';
import type * as THREE from 'three';
import Vegetation from '../Environment/Vegetation';
import Grass from '../Environment/Grass';
import Foliage from '../Environment/Foliage';
import Reeds from '../Environment/Reeds';
import Driftwood from '../Environment/Driftwood';
import FallingLeaves from '../Environment/FallingLeaves';
import Fireflies from '../Environment/Fireflies';
import Birds from '../Environment/Birds';
import Bats from '../Environment/Bats';
import Fish from '../Environment/Fish';
import Pebbles from '../Environment/Pebbles';
import Mist from '../Environment/Mist';
import WaterLilies from '../Environment/WaterLilies';
import SunShafts from '../Environment/SunShafts';
import Ferns from '../Environment/Ferns';
import Rapids from '../Environment/Rapids';
import Dragonflies from '../Environment/Dragonflies';
import Pinecone from '../Environment/Pinecone';
import Mushrooms from '../Environment/Mushrooms';
import RockFoam from '../Environment/RockFoam';
import Wildflowers from '../Environment/Wildflowers';
import CanyonDust from '../Environment/CanyonDust';
import Cactus from '../Environment/Cactus';
import DesertSage from '../Environment/DesertSage';
import CanyonGrass from '../Environment/CanyonGrass';
import LumberProps from '../LumberProps';
import IndustrialProps from '../IndustrialProps';
import type { PlacementData } from './types';

export type TrackSegmentDecorationsProps = {
  vegetationGroupRef: React.RefObject<THREE.Group | null>;
  rimVegetationGroupRef: React.RefObject<THREE.Group | null>;
  placementData: PlacementData;
  biome: string;
  isSlotCanyon: boolean;
  isLumberFlume: boolean;
  isHydroDam: boolean;
  lumberPropPositions: THREE.Vector3[];
  industrialPositions: {
    pipes: THREE.Vector3[];
    railings: THREE.Vector3[];
    catwalks: THREE.Vector3[];
    gates: THREE.Vector3[];
  };
  catwalkWashedOut: boolean;
  rockMaterial: THREE.Material;
  flowSpeed: number;
  playerVelocityRef: React.MutableRefObject<number> | React.RefObject<number>;
  allowCanyonDust: boolean;
  birdType: string;
  isNight: boolean;
  batsActive: boolean;
  waterLevel: number;
  mergedRockFoam: PlacementData['rockFoam'];
};

/** Bank / fauna / prop decorations for a track segment (visual-only). */
export function TrackSegmentDecorations({
  vegetationGroupRef,
  rimVegetationGroupRef,
  placementData,
  biome,
  isSlotCanyon,
  isLumberFlume,
  isHydroDam,
  lumberPropPositions,
  industrialPositions,
  catwalkWashedOut,
  rockMaterial,
  flowSpeed,
  playerVelocityRef,
  allowCanyonDust,
  birdType,
  isNight,
  batsActive,
  waterLevel,
  mergedRockFoam,
}: TrackSegmentDecorationsProps) {
  return (
    <>
      <group ref={vegetationGroupRef}>
        {isSlotCanyon ? (
          <>
            <Cactus transforms={placementData.cactus} />
            <DesertSage transforms={placementData.desertSage} />
            <CanyonGrass transforms={placementData.canyonGrass} />
          </>
        ) : (
          <Vegetation transforms={placementData.trees} biome={biome} />
        )}

        <Grass transforms={placementData.grass} biome={biome} />
        <Foliage transforms={placementData.grass} biome={biome} density={1.2} />
        <Wildflowers transforms={placementData.wildflowers} biome={biome} />
        <Ferns transforms={placementData.ferns} biome={biome} />
        <Mushrooms transforms={placementData.mushrooms} biome={biome} />
        <Reeds transforms={placementData.reeds} />
        <Pebbles transforms={placementData.pebbles} material={rockMaterial} />
        <Driftwood transforms={placementData.driftwood} />

        {isLumberFlume && lumberPropPositions.length > 0 && (
          <>
            <LumberProps type="plank" positions={lumberPropPositions.slice(0, 4)} />
            <LumberProps type="log" positions={lumberPropPositions.slice(2, 6)} />
            <LumberProps type="barrel" positions={lumberPropPositions.slice(5, 8)} />
          </>
        )}

        {isHydroDam && (
          <>
            <IndustrialProps type="pipe" positions={industrialPositions.pipes} />
            <IndustrialProps
              type="railing"
              positions={industrialPositions.railings}
              washedOut={catwalkWashedOut}
            />
            <IndustrialProps
              type="catwalk"
              positions={industrialPositions.catwalks}
              washedOut={catwalkWashedOut}
            />
            <IndustrialProps type="gate" positions={industrialPositions.gates} />
          </>
        )}

        <Pinecone transforms={placementData.pinecones} />
        <FallingLeaves transforms={placementData.leaves} biome={biome} />
        <FallingLeaves transforms={placementData.floatingLeaves} biome={biome} floating={true} />
        <WaterLilies transforms={placementData.waterLilies} />
        <Mist
          transforms={placementData.mist}
          flowSpeed={flowSpeed}
          playerVelocityRef={playerVelocityRef}
          isSlotCanyon={isSlotCanyon}
        />
        {isSlotCanyon && allowCanyonDust && (
          <CanyonDust
            transforms={placementData.canyonDust}
            playerVelocityRef={playerVelocityRef}
            flowSpeed={flowSpeed}
            count={64}
            maxDistance={30}
          />
        )}
        <Fireflies transforms={placementData.fireflies} />
        <Dragonflies transforms={placementData.dragonflies} />
        <Birds transforms={placementData.birds} birdType={birdType} isNight={isNight || batsActive} />
        <Bats transforms={placementData.bats} visible={batsActive} waterLevel={waterLevel} />
        <Fish transforms={placementData.fish} />
        <Rapids transforms={placementData.rapids} flowSpeed={flowSpeed} />
        <RockFoam transforms={mergedRockFoam} flowSpeed={flowSpeed} />
        <SunShafts transforms={placementData.sunShafts} flowSpeed={flowSpeed} isSlotCanyon={isSlotCanyon} />
      </group>

      <group ref={rimVegetationGroupRef}>
        <Vegetation transforms={placementData.rimTrees} biome={biome} isRim={true} />
      </group>
    </>
  );
}
