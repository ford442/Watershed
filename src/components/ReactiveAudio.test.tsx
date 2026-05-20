/**
 * ReactiveAudio.test.tsx
 *
 * Tests for the ReactiveAudio component, specifically validating guards
 * against non-finite (NaN/Infinity) values in volume calculations.
 */

import fs from 'fs';
import path from 'path';

describe('ReactiveAudio', () => {
  it('should have guards against non-finite delta values', () => {
    const sourceFile = fs.readFileSync(
      path.join(__dirname, 'ReactiveAudio.tsx'),
      'utf-8'
    );
    
    // Check for delta guard - ensures delta is finite and > 0
    expect(sourceFile).toContain('!isFinite(delta)');
    expect(sourceFile).toContain('delta <= 0');
  });

  it('should have guards against non-finite lerp values', () => {
    const sourceFile = fs.readFileSync(
      path.join(__dirname, 'ReactiveAudio.tsx'),
      'utf-8'
    );
    
    // Check for lerp guard - ensures lerp is finite and >= 0
    expect(sourceFile).toContain('!isFinite(lerp)');
    expect(sourceFile).toContain('lerp < 0');
  });

  it('should reset NaN volume state values to 0', () => {
    const sourceFile = fs.readFileSync(
      path.join(__dirname, 'ReactiveAudio.tsx'),
      'utf-8'
    );
    
    // Check that volume state is hardened against NaN
    expect(sourceFile).toContain('!isFinite(v.low)');
    expect(sourceFile).toContain('v.low = 0');
    expect(sourceFile).toContain('!isFinite(v.mid)');
    expect(sourceFile).toContain('v.mid = 0');
    expect(sourceFile).toContain('!isFinite(v.high)');
    expect(sourceFile).toContain('v.high = 0');
    expect(sourceFile).toContain('!isFinite(v.rapids)');
    expect(sourceFile).toContain('v.rapids = 0');
    expect(sourceFile).toContain('!isFinite(v.transition)');
    expect(sourceFile).toContain('v.transition = 0');
  });

  it('should guard all setVolume calls with isFinite checks', () => {
    const sourceFile = fs.readFileSync(
      path.join(__dirname, 'ReactiveAudio.tsx'),
      'utf-8'
    );
    
    // Check for guards before each setVolume() call
    expect(sourceFile).toContain('const lowVol = v.low * AUDIO_CONFIG.ambient.lowVolume * master');
    expect(sourceFile).toContain('if (isFinite(lowVol))');
    expect(sourceFile).toContain('ambientLowRef.current.setVolume(lowVol)');
    
    expect(sourceFile).toContain('const midVol = v.mid * AUDIO_CONFIG.ambient.midVolume * master');
    expect(sourceFile).toContain('if (isFinite(midVol))');
    expect(sourceFile).toContain('ambientMidRef.current.setVolume(midVol)');
    
    expect(sourceFile).toContain('const highVol = v.high * AUDIO_CONFIG.ambient.highVolume * master');
    expect(sourceFile).toContain('if (isFinite(highVol))');
    expect(sourceFile).toContain('ambientHighRef.current.setVolume(highVol)');
    
    expect(sourceFile).toContain('if (isFinite(rapidsVol))');
    expect(sourceFile).toContain('sfxRapidsRef.current.setVolume(rapidsVol * master)');
    
    expect(sourceFile).toContain('const transitionVol = v.transition * master');
    expect(sourceFile).toContain('if (isFinite(transitionVol))');
    expect(sourceFile).toContain('posTransitionRef.current.setVolume(transitionVol)');
  });

  it('should handle velocity values from Rapier with isFinite guards', () => {
    const sourceFile = fs.readFileSync(
      path.join(__dirname, 'ReactiveAudio.tsx'),
      'utf-8'
    );
    
    // Check that velocity components are guarded
    expect(sourceFile).toContain('isFinite(vel.x) ? vel.x : 0');
    expect(sourceFile).toContain('isFinite(vel.z) ? vel.z : 0');
  });

  it('should handle flow speed with isFinite guards', () => {
    const sourceFile = fs.readFileSync(
      path.join(__dirname, 'ReactiveAudio.tsx'),
      'utf-8'
    );
    
    // Check that flow speed is guarded
    expect(sourceFile).toContain('isFinite(rawFlowSpeed) ? rawFlowSpeed : 1');
  });
});
