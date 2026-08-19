/**
 * Reports active renderer backend to the module-level rendererState store.
 * Must live inside <Canvas>.
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import {
  detectActiveBackend,
  getRendererDisplayName,
  isWebGpuNavigatorAvailable,
  updateRendererDiagnostics,
} from './rendererState';
import type { RendererPreference } from './types';
import { extractRendererGpuDevice, registerSessionGpuDevice } from './gpuChores/device';

export interface RendererDiagnosticsMonitorProps {
  preference: RendererPreference;
}

export default function RendererDiagnosticsMonitor({ preference }: RendererDiagnosticsMonitorProps) {
  const { gl } = useThree();

  useEffect(() => {
    const activeBackend = detectActiveBackend(gl as Parameters<typeof detectActiveBackend>[0]);
    updateRendererDiagnostics({
      preference,
      activeBackend,
      rendererName: getRendererDisplayName(preference, activeBackend),
      webgpuAvailable: isWebGpuNavigatorAvailable(),
    });
    registerSessionGpuDevice(extractRendererGpuDevice(gl));
    return () => {
      registerSessionGpuDevice(null);
    };
  }, [gl, preference]);

  return null;
}
