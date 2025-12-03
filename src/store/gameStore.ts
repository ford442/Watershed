import { create } from 'zustand';

export interface ChunkData {
  id: string;
  position: [number, number, number];
  loaded: boolean;
}

export interface GameState {
  // Game metrics
  score: number;
  health: number;
  gameSpeed: number;
  
  // Chunk management
  chunks: ChunkData[];
  activeChunkId: string | null;
  
  // Game state
  isPaused: boolean;
  isGameOver: boolean;
  
  // Actions
  setScore: (score: number) => void;
  incrementScore: (amount: number) => void;
  setHealth: (health: number) => void;
  decreaseHealth: (amount: number) => void;
  setGameSpeed: (speed: number) => void;
  addChunk: (chunk: ChunkData) => void;
  removeChunk: (chunkId: string) => void;
  setActiveChunk: (chunkId: string) => void;
  togglePause: () => void;
  setGameOver: (isOver: boolean) => void;
  resetGame: () => void;
}

const initialState = {
  score: 0,
  health: 100,
  gameSpeed: 1.0,
  chunks: [],
  activeChunkId: null,
  isPaused: false,
  isGameOver: false,
};

export const useGameStore = create<GameState>((set) => ({
  ...initialState,
  
  setScore: (score) => set({ score }),
  incrementScore: (amount) => set((state) => ({ score: state.score + amount })),
  
  setHealth: (health) => set({ health: Math.max(0, Math.min(100, health)) }),
  decreaseHealth: (amount) => set((state) => {
    const newHealth = Math.max(0, state.health - amount);
    return {
      health: newHealth,
      isGameOver: newHealth === 0,
    };
  }),
  
  setGameSpeed: (gameSpeed) => set({ gameSpeed }),
  
  addChunk: (chunk) => set((state) => ({
    chunks: [...state.chunks, chunk],
  })),
  
  removeChunk: (chunkId) => set((state) => ({
    chunks: state.chunks.filter((chunk) => chunk.id !== chunkId),
  })),
  
  setActiveChunk: (activeChunkId) => set({ activeChunkId }),
  
  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),
  
  setGameOver: (isGameOver) => set({ isGameOver }),
  
  resetGame: () => set(initialState),
}));
