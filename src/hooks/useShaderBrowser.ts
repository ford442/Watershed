// src/hooks/useShaderBrowser.ts
// Browse, filter, and hot-swap community shaders

import { useState, useEffect, useCallback } from 'react';

export interface Shader {
  id: string;
  name: string;
  author: string;
  description?: string;
  tags: string[];
  stars: number;
  rating_count: number;
  category?: string;
  type?: 'vertex' | 'fragment' | 'compute';
  thumbnail?: string;
  createdAt?: string;
}

interface UseShaderBrowserReturn {
  shaders: Shader[];
  loading: boolean;
  error: string | null;
  filterCategory: string;
  setFilterCategory: (cat: string) => void;
  filterType: 'all' | 'vertex' | 'fragment' | 'compute';
  setFilterType: (type: 'all' | 'vertex' | 'fragment' | 'compute') => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  tryShader: (shaderId: string) => void;
  refresh: () => void;
}

/**
 * useShaderBrowser — Fetch and filter community shaders
 * 
 * Features:
 * - Fetch from /api/shaders endpoint
 * - Filter by category, type, search term
 * - One-click hot-swap dispatch
 */
export const useShaderBrowser = (): UseShaderBrowserReturn => {
  const [shaders, setShaders] = useState<Shader[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterType, setFilterType] = useState<'all' | 'vertex' | 'fragment' | 'compute'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchShaders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filterCategory !== 'all') params.set('category', filterCategory);
      if (filterType !== 'all') params.set('type', filterType);
      // Note: Backend search support may vary — client-side filter as fallback

      const res = await fetch(`/api/shaders?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Failed to load shaders (${res.status})`);
      }

      const data = await res.json();
      
      // Handle different response shapes
      const shaderList = Array.isArray(data) ? data : data.shaders || [];
      
      // Client-side search filter (if backend doesn't support it)
      let filtered = shaderList;
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        filtered = shaderList.filter((s: Shader) =>
          s.name?.toLowerCase().includes(term) ||
          s.description?.toLowerCase().includes(term) ||
          s.tags?.some(t => t.toLowerCase().includes(term))
        );
      }

      setShaders(filtered);
      console.log(`[useShaderBrowser] Loaded ${filtered.length} shaders`);
    } catch (err: any) {
      setError(err.message);
      console.error('[useShaderBrowser] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterType, searchTerm]);

  useEffect(() => {
    fetchShaders();
  }, [fetchShaders]);

  // Hot-swap dispatcher
  const tryShader = useCallback((shaderId: string) => {
    window.dispatchEvent(
      new CustomEvent('watershed:swapShader', { 
        detail: { shaderId, timestamp: Date.now() } 
      })
    );
    console.log(`[ShaderBrowser] Hot-swap requested: ${shaderId}`);
  }, []);

  return {
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
    refresh: fetchShaders,
  };
};

export default useShaderBrowser;
