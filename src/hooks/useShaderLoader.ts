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

    // No shader API on this deploy (the static build has none): a relative
    // /api fetch would 404 once per segment mount. Use the builtin directly.
    if (!API_BASE_URL) {
      setResult({ code: fallbackCode, loading: false, error: 'no shader API configured (VITE_API_URL)' });
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

    // load() reports its own failures (try / catch → error state).
    void load();

    return () => { 
      mounted = false; 
    };
  }, [shaderId, fallbackCode]);

  return result;
};
