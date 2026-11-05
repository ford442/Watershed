/**
 * useAssetInstance — mount an authored prop, or its primitive until the pack lands (#536 A.2).
 *
 * Never suspends: the first render returns `buildFallback()` (today's primitive), the pack load
 * starts in an effect, and the authored instance replaces the primitive on the render after it
 * arrives. The instance that goes out of use is disposed. `buildFallback` must be stable
 * (a module-level function): it is read once per asset state, not per render.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  getAsset,
  instantiateAsset,
  requestAsset,
  subscribeAssets,
  type AssetInstance,
  type AssetProp,
  type InstantiateOptions,
} from './AssetRegistry';

export function useAssetInstance(
  prop: AssetProp,
  buildFallback: () => AssetInstance,
  options?: InstantiateOptions,
): AssetInstance {
  const asset = useSyncExternalStore(
    subscribeAssets,
    () => getAsset(prop),
    () => null,
  );
  useEffect(() => {
    requestAsset(prop);
  }, [prop]);
  const castShadow = options?.castShadow;
  const receiveShadow = options?.receiveShadow;
  const instance = useMemo(
    () => (asset ? instantiateAsset(asset, { castShadow, receiveShadow }) : buildFallback()),
    [asset, buildFallback, castShadow, receiveShadow],
  );
  useEffect(() => () => instance.dispose(), [instance]);
  return instance;
}
