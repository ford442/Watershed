import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleSegmentFlow } from '../utils/segmentSampler';

const tmpPoint = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpCross = new THREE.Vector3();

export default function WaterForces({
    targetRef,
    segments = [],
    flowScale = 1,
    enabled = true,
}) {
    const flowFieldRef = useRef({
        version: 1,
        sample: null,
    });

    useMemo(() => {
        flowFieldRef.current.version += 1;
        return flowFieldRef.current;
    }, [segments]);

    useFrame((state, delta) => {
        if (!enabled || !targetRef?.current) return;

        const body = targetRef.current;
        const translation = body.translation();
        tmpPoint.set(translation.x, translation.y, translation.z);

        let closestSample = null;
        let closestDistance = Infinity;

        for (const segment of segments) {
            if (!segment?.active) continue;
            const sample = sampleSegmentFlow(segment, tmpPoint);
            if (!sample) continue;

            if (sample.distance < closestDistance) {
                closestDistance = sample.distance;
                closestSample = sample;
            }
        }

        if (!closestSample || closestDistance > 28) return;

        const current = body.linvel();
        tmpForward.set(current.x, 0, current.z);
        if (tmpForward.lengthSq() < 0.0001) {
            tmpForward.set(0, 0, -1);
        } else {
            tmpForward.normalize();
        }

        const stateBoost = closestSample.state === 'Flooded' ? 1.45 : closestSample.state === 'HighFlow' ? 1.2 : 1;
        const impulseStrength = Math.max(0.4, closestSample.flowSpeed * stateBoost * flowScale);
        const alignment = tmpForward.dot(closestSample.tangent);
        const shedFactor = 1 - Math.max(-1, Math.min(1, alignment));

        const alongFlow = closestSample.tangent.clone().multiplyScalar(impulseStrength * delta * 2.0);
        const sideSlip = closestSample.lateral.clone().multiplyScalar((closestDistance / Math.max(closestSample.canyonWidth, 1)) * 0.15 * delta);

        if (!isFinite(alongFlow.x) || !isFinite(alongFlow.z) || !isFinite(sideSlip.x) || !isFinite(sideSlip.z)) return;
        body.applyImpulse({ x: alongFlow.x, y: -0.18 * impulseStrength * delta, z: alongFlow.z }, true);
        body.applyImpulse({ x: sideSlip.x, y: 0, z: sideSlip.z }, true);

        tmpCross.crossVectors(tmpForward, closestSample.tangent);
        const torqueX = tmpCross.x * shedFactor * impulseStrength * delta * 0.8;
        const torqueY = tmpCross.y * shedFactor * impulseStrength * delta * 1.1;
        const torqueZ = tmpCross.z * shedFactor * impulseStrength * delta * 0.8;
        if (!isFinite(torqueX) || !isFinite(torqueY) || !isFinite(torqueZ)) return;
        body.applyTorqueImpulse({
            x: torqueX,
            y: torqueY,
            z: torqueZ,
        }, true);

        flowFieldRef.current.sample = {
            time: state.clock.elapsedTime,
            point: closestSample.point.toArray(),
            tangent: closestSample.tangent.toArray(),
            flowSpeed: closestSample.flowSpeed,
            state: closestSample.state,
        };
    });

    return null;
}
