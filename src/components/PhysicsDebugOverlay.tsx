import React, { useEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface PhysicsDebugOverlayProps {
  enabled: boolean;
  vehicleRef: React.MutableRefObject<any>;
}

interface DebugImpulse {
  tag: string;
  impulse: { x: number; y: number; z: number };
}

interface DebugContact {
  point: { x: number; y: number; z: number };
}

interface PhysicsDebugSnapshot {
  position: { x: number; y: number; z: number };
  linearVelocity: { x: number; y: number; z: number };
  angularVelocity: { x: number; y: number; z: number };
  speed: number;
  slopeAngle: number;
  bankAngle: number;
  isGrounded: boolean;
  jumpState: string;
  friction: number;
  waterfallGravityMultiplier: number;
  effectiveG: number;
  extraGravity: number;
  currentSegmentIndex: number;
  groundRay: {
    origin: { x: number; y: number; z: number };
    hitPoint: { x: number; y: number; z: number } | null;
    distance: number | null;
  };
  groundNormal: { x: number; y: number; z: number };
  recentImpulses: DebugImpulse[];
  recentContacts: DebugContact[];
}

const MAX_CONTACT_MARKERS = 8;

const PhysicsDebugOverlay = ({ enabled, vehicleRef }: PhysicsDebugOverlayProps) => {
  const gizmoGroupRef = useRef<THREE.Group>(null);
  const hudRef = useRef<HTMLPreElement>(null);
  const velocityArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const angularArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const normalArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const gravityArrowRef = useRef<THREE.ArrowHelper | null>(null);
  const rayLineRef = useRef<THREE.Line | null>(null);
  const impulseLineRef = useRef<THREE.Line | null>(null);
  const contactMarkersRef = useRef<THREE.Mesh[]>([]);

  useEffect(() => {
    const group = gizmoGroupRef.current;
    if (!group || velocityArrowRef.current) return;

    velocityArrowRef.current = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      0.001,
      0x00ff88,
      0.2,
      0.1
    );
    angularArrowRef.current = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(),
      0.001,
      0xff66cc,
      0.2,
      0.1
    );
    normalArrowRef.current = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      0.001,
      0x66aaff,
      0.2,
      0.1
    );
    gravityArrowRef.current = new THREE.ArrowHelper(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(),
      0.001,
      0xff4444,
      0.2,
      0.1
    );
    group.add(velocityArrowRef.current, angularArrowRef.current, normalArrowRef.current, gravityArrowRef.current);

    const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    rayLineRef.current = new THREE.Line(
      rayGeometry,
      new THREE.LineBasicMaterial({ color: 0xffee44, transparent: true, opacity: 0.9 })
    );
    group.add(rayLineRef.current);

    const impulseGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    impulseLineRef.current = new THREE.Line(
      impulseGeometry,
      new THREE.LineBasicMaterial({ color: 0xff9922, transparent: true, opacity: 0.9 })
    );
    group.add(impulseLineRef.current);

    const markerGeometry = new THREE.SphereGeometry(0.12, 8, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff2255 });
    contactMarkersRef.current = Array.from({ length: MAX_CONTACT_MARKERS }, () => {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.visible = false;
      group.add(marker);
      return marker;
    });
  }, []);

  useFrame(() => {
    const group = gizmoGroupRef.current;
    if (!group) return;

    if (!enabled) {
      group.visible = false;
      if (hudRef.current) hudRef.current.style.display = 'none';
      return;
    }

    group.visible = true;
    if (hudRef.current) hudRef.current.style.display = 'block';

    const body = vehicleRef.current;
    const snapshot = (body?.userData?.physicsDebug ?? (window as any).__watershedPhysicsDebug) as PhysicsDebugSnapshot | undefined;
    if (!snapshot || !body) return;

    const pos = snapshot.position;
    const vel = snapshot.linearVelocity;
    const ang = snapshot.angularVelocity;
    const groundNormal = snapshot.groundNormal;

    const vehiclePos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const velDir = new THREE.Vector3(vel.x, vel.y, vel.z);
    const angDir = new THREE.Vector3(ang.x, ang.y, ang.z);
    const normalDir = new THREE.Vector3(groundNormal.x, groundNormal.y, groundNormal.z).normalize();

    if (velocityArrowRef.current) {
      const velLen = Math.max(velDir.length(), 0.001);
      velocityArrowRef.current.position.copy(vehiclePos);
      velocityArrowRef.current.setDirection(velLen > 0.001 ? velDir.clone().normalize() : new THREE.Vector3(0, 1, 0));
      velocityArrowRef.current.setLength(Math.min(4.5, velLen * 0.18 + 0.2), 0.25, 0.14);
    }

    if (angularArrowRef.current) {
      const angLen = Math.max(angDir.length(), 0.001);
      angularArrowRef.current.position.copy(vehiclePos).add(new THREE.Vector3(0.35, 0.1, 0));
      angularArrowRef.current.setDirection(angLen > 0.001 ? angDir.clone().normalize() : new THREE.Vector3(1, 0, 0));
      angularArrowRef.current.setLength(Math.min(2.0, angLen * 0.25 + 0.15), 0.18, 0.1);
    }

    if (normalArrowRef.current) {
      const normalOrigin = snapshot.groundRay.hitPoint
        ? new THREE.Vector3(snapshot.groundRay.hitPoint.x, snapshot.groundRay.hitPoint.y, snapshot.groundRay.hitPoint.z)
        : vehiclePos.clone().add(new THREE.Vector3(0, -0.5, 0));
      normalArrowRef.current.position.copy(normalOrigin);
      normalArrowRef.current.setDirection(normalDir.lengthSq() > 0 ? normalDir : new THREE.Vector3(0, 1, 0));
      normalArrowRef.current.setLength(1.5, 0.18, 0.1);
    }

    if (gravityArrowRef.current) {
      const gravityMag = Math.abs(snapshot.extraGravity);
      gravityArrowRef.current.visible = gravityMag > 0.01;
      gravityArrowRef.current.position.copy(vehiclePos).add(new THREE.Vector3(-0.35, 0.1, 0));
      gravityArrowRef.current.setDirection(new THREE.Vector3(0, -1, 0));
      gravityArrowRef.current.setLength(Math.min(2.2, gravityMag * 0.08 + 0.15), 0.18, 0.1);
    }

    if (rayLineRef.current) {
      const origin = new THREE.Vector3(snapshot.groundRay.origin.x, snapshot.groundRay.origin.y, snapshot.groundRay.origin.z);
      const target = snapshot.groundRay.hitPoint
        ? new THREE.Vector3(snapshot.groundRay.hitPoint.x, snapshot.groundRay.hitPoint.y, snapshot.groundRay.hitPoint.z)
        : origin.clone().add(new THREE.Vector3(0, -5, 0));
      rayLineRef.current.geometry.setFromPoints([origin, target]);
    }

    if (impulseLineRef.current) {
      const recent = snapshot.recentImpulses[snapshot.recentImpulses.length - 1];
      const start = vehiclePos.clone();
      const end = recent
        ? start.clone().add(new THREE.Vector3(recent.impulse.x, recent.impulse.y, recent.impulse.z).multiplyScalar(0.5))
        : start.clone();
      impulseLineRef.current.visible = !!recent;
      impulseLineRef.current.geometry.setFromPoints([start, end]);
    }

    contactMarkersRef.current.forEach((marker, idx) => {
      const contact = snapshot.recentContacts[snapshot.recentContacts.length - 1 - idx];
      if (!contact) {
        marker.visible = false;
        return;
      }
      marker.visible = true;
      marker.position.set(contact.point.x, contact.point.y, contact.point.z);
    });

    if (hudRef.current) {
      const recentImpulses = snapshot.recentImpulses
        .slice(-4)
        .map((entry) => `${entry.tag}:${Math.sqrt(entry.impulse.x ** 2 + entry.impulse.y ** 2 + entry.impulse.z ** 2).toFixed(2)}`)
        .join(', ');
      hudRef.current.textContent = [
        `speed ${snapshot.speed.toFixed(2)} m/s`,
        `slope ${snapshot.slopeAngle.toFixed(1)}° bank ${snapshot.bankAngle.toFixed(1)}°`,
        `grounded ${snapshot.isGrounded ? 'yes' : 'no'} | jump ${snapshot.jumpState}`,
        `friction ${snapshot.friction.toFixed(2)} | g ${snapshot.effectiveG.toFixed(2)} (${snapshot.waterfallGravityMultiplier.toFixed(2)}x)`,
        `segment ${snapshot.currentSegmentIndex} | ray ${snapshot.groundRay.distance !== null ? snapshot.groundRay.distance.toFixed(2) : 'miss'}`,
        `impulses ${recentImpulses || '—'}`,
      ].join('\n');
    }
  });

  return (
    <>
      <group ref={gizmoGroupRef} visible={enabled} />
      <Html fullscreen zIndexRange={[130, 0]} style={{ pointerEvents: 'none' }}>
        <pre
          ref={hudRef}
          style={{
            position: 'fixed',
            top: 12,
            left: 12,
            margin: 0,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(120, 200, 255, 0.45)',
            background: 'rgba(0,0,0,0.62)',
            color: '#bdf2ff',
            fontSize: 11,
            lineHeight: 1.35,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            whiteSpace: 'pre',
          }}
        />
      </Html>
    </>
  );
};

export default PhysicsDebugOverlay;
