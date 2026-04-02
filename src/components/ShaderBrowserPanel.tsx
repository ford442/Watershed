// src/components/ShaderBrowserPanel.tsx
// In-game shader gallery with hot-swap

import React, { useEffect } from 'react';
import { useShaderBrowser } from '../hooks/useShaderBrowser';

interface ShaderBrowserPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'realistic', label: 'Realistic' },
  { value: 'stylized', label: 'Stylized' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'experimental', label: 'Experimental' },
];

const TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'vertex', label: 'Vertex' },
  { value: 'fragment', label: 'Fragment' },
  { value: 'compute', label: 'Compute' },
];

/**
 * ShaderBrowserPanel — Modal gallery for browsing community shaders
 * 
 * Features:
 * - Grid view with thumbnails and ratings
 * - Search, category, and type filtering
 * - One-click "Try Now" hot-swap
 * - Keyboard shortcut support (Escape to close)
 */
export const ShaderBrowserPanel: React.FC<ShaderBrowserPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    shaders,
    loading,
    error,
    filterCategory,
    setFilterCategory,
    filterType,
    setFilterType,
    searchTerm,
    setSearchTerm,
    tryShader,
    refresh,
  } = useShaderBrowser();

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        
        {/* Header */}
        <div className="px-8 py-5 border-b border-zinc-700 flex items-center justify-between bg-zinc-900">
          <div>
            <h2 className="text-2xl font-bold text-white">Shader Gallery</h2>
            <p className="text-zinc-400 text-sm mt-1">Browse and try community water shaders</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-full transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="px-8 py-4 border-b border-zinc-700 bg-zinc-900/50 flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search shaders..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-800 text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 placeholder-zinc-500"
            />
          </div>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-zinc-800 text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="bg-zinc-800 text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>

          <button
            onClick={refresh}
            disabled={loading}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-auto bg-zinc-950">
          {loading && shaders.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
              <svg className="w-12 h-12 animate-spin mb-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p>Loading shaders...</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-red-400">
              <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p>{error}</p>
              <button 
                onClick={refresh}
                className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && shaders.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
              <svg className="w-12 h-12 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>No shaders found</p>
              <p className="text-sm mt-2">Try adjusting your search or filters</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {shaders.map(shader => (
              <div
                key={shader.id}
                className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 hover:border-emerald-500/50 transition-all group"
              >
                {/* Thumbnail */}
                <div className="h-40 bg-zinc-950 flex items-center justify-center relative overflow-hidden">
                  {shader.thumbnail ? (
                    <img 
                      src={shader.thumbnail} 
                      alt={shader.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="text-emerald-500 text-6xl opacity-50 group-hover:opacity-100 group-hover:scale-110 transition-all">
                      🌊
                    </div>
                  )}
                  
                  {/* Rating badge */}
                  <div className="absolute top-3 right-3 bg-black/70 backdrop-blur text-amber-400 text-sm px-2.5 py-1 rounded-full flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    {shader.stars?.toFixed(1) ?? '0.0'}
                  </div>

                  {/* Type badge */}
                  {shader.type && (
                    <div className="absolute top-3 left-3 bg-emerald-600/80 backdrop-blur text-white text-xs px-2 py-1 rounded-full">
                      {shader.type}
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <h3 className="font-bold text-lg text-white truncate">{shader.name}</h3>
                  <p className="text-zinc-400 text-sm">by {shader.author}</p>
                  
                  {shader.description && (
                    <p className="text-zinc-500 text-sm mt-2 line-clamp-2">
                      {shader.description}
                    </p>
                  )}

                  {/* Tags */}
                  {shader.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {shader.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-1 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                      {shader.tags.length > 3 && (
                        <span className="text-[10px] text-zinc-500 px-1">+{shader.tags.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Try Now button */}
                  <button
                    onClick={() => {
                      tryShader(shader.id);
                      onClose(); // Optional: close browser after selection
                    }}
                    className="mt-5 w-full bg-zinc-800 hover:bg-emerald-600 text-white py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Try Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-zinc-700 bg-zinc-900 text-zinc-400 text-sm flex justify-between items-center">
          <span>{shaders.length} shader{shaders.length !== 1 ? 's' : ''} available</span>
          <span>Press ESC to close</span>
        </div>
      </div>
    </div>
  );
};

export default ShaderBrowserPanel;
