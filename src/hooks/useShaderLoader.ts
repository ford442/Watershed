/**
 * useShaderLoader Hook
 * 
 * Loads shader code dynamically from the FastAPI backend.
 * Falls back gracefully to local shader code on failure.
 * Caches results to avoid repeated fetches.
 */

import { useState, useEffect, useRef } from 'react';

export interface ShaderLoadResult {
  code: string | null;
  loading: boolean;
  error: string | null;
}

export interface ShaderMetadata {
  id: string;
  name: string;
  description?: string;
  type: 'vertex' | 'fragment' | 'compute';
  tags?: string[];
  stars?: number;
  createdAt?: string;
  updatedAt?: string;
}

// Simple in-memory cache for shader code
const shaderCache = new Map<string, { code: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const useShaderLoader = (
  shaderId: string | null,
  fallbackCode: string = ''
): ShaderLoadResult => {
  const [result, setResult] = useState<ShaderLoadResult>({
    code: null,
    loading: !!shaderId,
    error: null,
  });

  const shaderIdRef = useRef(shaderId);

  useEffect(() => {
    if (!shaderId) {
      setResult({ 
        code: fallbackCode, 
        loading: false, 
        error: null 
      });
      return;
    }

    // Check cache first
    const cached = shaderCache.get(shaderId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`[useShaderLoader] Cache hit for ${shaderId}`);
      setResult({
        code: cached.code,
        loading: false,
        error: null,
      });
      return;
    }

    let mounted = true;
    shaderIdRef.current = shaderId;

    const load = async () => {
      setResult(prev => ({ ...prev, loading: true, error: null }));

      try {
        const res = await fetch(`${API_BASE_URL}/api/shaders/${shaderId}/code`, {
          method: 'GET',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!res.ok) {
          throw new Error(`Shader ${shaderId} not found (${res.status})`);
        }

        const data = await res.json();
        
        if (!mounted) return;

        const shaderCode = data.code || fallbackCode;
        
        // Cache the result
        shaderCache.set(shaderId, {
          code: shaderCode,
          timestamp: Date.now(),
        });

        setResult({
          code: shaderCode,
          loading: false,
          error: null,
        });

        console.log(`[useShaderLoader] Loaded shader ${shaderId} (${shaderCode.length} chars)`);
      } catch (err: any) {
        console.warn(`[useShaderLoader] Falling back for ${shaderId}:`, err.message);
        
        if (!mounted) return;

        setResult({
          code: fallbackCode,
          loading: false,
          error: err.message,
        });
      }
    };

    load();

    return () => { 
      mounted = false; 
    };
  }, [shaderId, fallbackCode]);

  return result;
};

/**
 * Hook to fetch shader metadata (for browsing/selection UI)
 */
export const useShaderList = (
  options?: {
    tag?: string;
    type?: 'vertex' | 'fragment' | 'compute';
    limit?: number;
  }
) => {
  const [shaders, setShaders] = useState<ShaderMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (options?.tag) params.append('tag', options.tag);
        if (options?.type) params.append('type', options.type);
        if (options?.limit) params.append('limit', options.limit.toString());

        const res = await fetch(`${API_BASE_URL}/api/shaders?${params}`, {
          headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) throw new Error(`Failed to fetch shaders (${res.status})`);

        const data = await res.json();
        setShaders(data.shaders || []);
      } catch (err: any) {
        console.warn('[useShaderList] Failed to load shader list:', err.message);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [options?.tag, options?.type, options?.limit]);

  return { shaders, loading, error };
};

/**
 * Utility to preload a shader into the cache
 */
export const preloadShader = async (shaderId: string): Promise<string | null> => {
  // Check cache first
  const cached = shaderCache.get(shaderId);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.code;
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/shaders/${shaderId}/code`);
    if (!res.ok) return null;
    
    const data = await res.json();
    const code = data.code;
    
    shaderCache.set(shaderId, {
      code,
      timestamp: Date.now(),
    });
    
    return code;
  } catch (err) {
    console.warn(`[preloadShader] Failed to preload ${shaderId}:`, err);
    return null;
  }
};

/**
 * Clear the shader cache
 */
export const clearShaderCache = (): void => {
  shaderCache.clear();
  console.log('[useShaderLoader] Shader cache cleared');
};

export default useShaderLoader;
