import React from 'react';
import Experience from '../Experience';

describe('Experience Smoke Tests', () => {
  it('Experience component is defined', () => {
    expect(Experience).toBeDefined();
    expect(typeof Experience).toBe('function');
  });

  it('Experience component can be instantiated', () => {
    // Simply check that the component can be created without errors
    expect(() => {
      const element = React.createElement(Experience);
      expect(element).toBeTruthy();
    }).not.toThrow();
  });
});
