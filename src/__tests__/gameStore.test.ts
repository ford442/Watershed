import { renderHook, act } from '@testing-library/react';
import { useGameStore } from '../store/gameStore';

describe('Game Store Tests', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    const { result } = renderHook(() => useGameStore());
    act(() => {
      result.current.resetGame();
    });
  });

  it('initializes with default values', () => {
    const { result } = renderHook(() => useGameStore());
    
    expect(result.current.score).toBe(0);
    expect(result.current.health).toBe(100);
    expect(result.current.gameSpeed).toBe(1.0);
    expect(result.current.chunks).toEqual([]);
    expect(result.current.activeChunkId).toBe(null);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isGameOver).toBe(false);
  });

  it('increments score correctly', () => {
    const { result } = renderHook(() => useGameStore());
    
    act(() => {
      result.current.incrementScore(10);
    });
    
    expect(result.current.score).toBe(10);
    
    act(() => {
      result.current.incrementScore(5);
    });
    
    expect(result.current.score).toBe(15);
  });

  it('decreases health and triggers game over', () => {
    const { result } = renderHook(() => useGameStore());
    
    act(() => {
      result.current.decreaseHealth(50);
    });
    
    expect(result.current.health).toBe(50);
    expect(result.current.isGameOver).toBe(false);
    
    act(() => {
      result.current.decreaseHealth(50);
    });
    
    expect(result.current.health).toBe(0);
    expect(result.current.isGameOver).toBe(true);
  });

  it('clamps health between 0 and 100', () => {
    const { result } = renderHook(() => useGameStore());
    
    act(() => {
      result.current.setHealth(150);
    });
    
    expect(result.current.health).toBe(100);
    
    act(() => {
      result.current.setHealth(-10);
    });
    
    expect(result.current.health).toBe(0);
  });

  it('manages chunks correctly', () => {
    const { result } = renderHook(() => useGameStore());
    
    const chunk1 = { id: 'chunk-1', position: [0, 0, 0] as [number, number, number], loaded: true };
    const chunk2 = { id: 'chunk-2', position: [0, 0, 100] as [number, number, number], loaded: true };
    
    act(() => {
      result.current.addChunk(chunk1);
      result.current.addChunk(chunk2);
    });
    
    expect(result.current.chunks).toHaveLength(2);
    expect(result.current.chunks[0]).toEqual(chunk1);
    
    act(() => {
      result.current.removeChunk('chunk-1');
    });
    
    expect(result.current.chunks).toHaveLength(1);
    expect(result.current.chunks[0].id).toBe('chunk-2');
  });

  it('toggles pause state', () => {
    const { result } = renderHook(() => useGameStore());
    
    expect(result.current.isPaused).toBe(false);
    
    act(() => {
      result.current.togglePause();
    });
    
    expect(result.current.isPaused).toBe(true);
    
    act(() => {
      result.current.togglePause();
    });
    
    expect(result.current.isPaused).toBe(false);
  });

  it('resets game to initial state', () => {
    const { result } = renderHook(() => useGameStore());
    
    act(() => {
      result.current.incrementScore(100);
      result.current.decreaseHealth(50);
      result.current.setGameSpeed(2.0);
      result.current.togglePause();
    });
    
    expect(result.current.score).toBe(100);
    expect(result.current.health).toBe(50);
    expect(result.current.isPaused).toBe(true);
    
    act(() => {
      result.current.resetGame();
    });
    
    expect(result.current.score).toBe(0);
    expect(result.current.health).toBe(100);
    expect(result.current.gameSpeed).toBe(1.0);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isGameOver).toBe(false);
  });
});
