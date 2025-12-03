# Test Suite Documentation

This directory contains the smoke test suite for the Watershed project. These tests ensure that core functionality remains intact after code changes.

## Test Categories

### 1. Smoke Tests
Basic tests that verify the application doesn't crash on startup and core components render correctly.

**Files:**
- `App.test.tsx` - Tests the main App component
- `Experience.test.tsx` - Tests the 3D scene Experience component

**Purpose:**
- Ensure the application renders without errors
- Verify canvas element is created
- Catch breaking changes early

### 2. State Management Tests
Tests for the Zustand game store to ensure state updates work correctly.

**Files:**
- `gameStore.test.ts` - Comprehensive tests for game state

**Coverage:**
- Score management
- Health tracking and game over logic
- Chunk management (add/remove)
- Pause state
- Game reset functionality

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode (recommended for development)
```bash
npm test -- --watch
```

### Run tests with coverage
```bash
npm test -- --coverage --watchAll=false
```

### Run specific test file
```bash
npm test App.test.tsx
```

## Test Guidelines for AI Agents

When making changes to the codebase, follow these testing guidelines:

### 1. Always Run Tests Before Making Changes
```bash
npm test -- --watchAll=false
```
This establishes a baseline and identifies any pre-existing issues.

### 2. Run Tests After Making Changes
After modifying code:
```bash
npm test -- --watchAll=false
```
Verify your changes don't break existing functionality.

### 3. Add Tests for New Features
When adding new features:
- Add corresponding tests in `src/__tests__/`
- Follow existing test patterns
- Test both success and failure cases

### 4. Test Coverage Requirements
- **Minimum**: Smoke tests must pass
- **Recommended**: Add unit tests for new state management or utility functions
- **Nice to have**: Integration tests for complex interactions

## Test Structure

### Smoke Tests Pattern
```typescript
describe('Component Smoke Tests', () => {
  it('renders without crashing', () => {
    const { container } = render(<Component />);
    expect(container).toBeTruthy();
  });
});
```

### State Management Test Pattern
```typescript
describe('State Tests', () => {
  beforeEach(() => {
    // Reset state before each test
  });

  it('updates state correctly', () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.updateValue(newValue);
    });
    expect(result.current.value).toBe(newValue);
  });
});
```

## Common Issues

### WebGL Context Issues
When testing React Three Fiber components, you may encounter WebGL context errors. These are expected in a headless test environment and can be ignored if the test passes.

### Mock Requirements
Some tests may require mocking:
- WebGL/Canvas APIs
- Audio context
- Network requests
- File system access

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:
- Fast execution (< 30 seconds for full suite)
- No external dependencies
- Headless compatible
- Clear pass/fail indicators

## Extending Tests

When adding new game systems, add corresponding tests:

### New World Biomes
```typescript
// src/__tests__/world/AlpineSlopes.test.tsx
it('generates terrain with correct parameters', () => {
  // Test biome-specific logic
});
```

### New Mechanics
```typescript
// src/__tests__/mechanics/RaftController.test.ts
it('applies water flow forces correctly', () => {
  // Test physics interactions
});
```

### New Systems
```typescript
// src/__tests__/systems/ChunkSystem.test.ts
it('loads and unloads chunks correctly', () => {
  // Test streaming system
});
```

## Test Maintenance

- **Regular Updates**: Keep tests updated with code changes
- **Remove Obsolete Tests**: Delete tests for removed features
- **Refactor Tests**: Apply DRY principles to test code
- **Document Edge Cases**: Add comments for complex test scenarios

## Performance Testing

For performance-critical code (physics, rendering), consider:
- Benchmark tests
- Memory leak detection
- Frame rate monitoring

These are not included in the smoke test suite but may be added as needed.
