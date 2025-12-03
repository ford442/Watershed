// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Mock ResizeObserver for React Three Fiber
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock WebGL context
HTMLCanvasElement.prototype.getContext = jest.fn().mockImplementation((type) => {
  if (type === 'webgl' || type === 'webgl2') {
    return {
      canvas: document.createElement('canvas'),
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
      getExtension: jest.fn(),
      getParameter: jest.fn(),
      getShaderPrecisionFormat: jest.fn().mockReturnValue({
        precision: 1,
        rangeMin: 1,
        rangeMax: 1,
      }),
      clearColor: jest.fn(),
      clear: jest.fn(),
      viewport: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      createShader: jest.fn(),
      shaderSource: jest.fn(),
      compileShader: jest.fn(),
      createProgram: jest.fn(),
      attachShader: jest.fn(),
      linkProgram: jest.fn(),
      useProgram: jest.fn(),
      deleteShader: jest.fn(),
      deleteProgram: jest.fn(),
    };
  }
  return null;
});

// Suppress console errors from React Three Fiber in tests
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Not implemented: HTMLCanvasElement.prototype.getContext') ||
       args[0].includes('Could not create WebGL context') ||
       args[0].includes('ResizeObserver'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
