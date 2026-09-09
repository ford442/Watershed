import { Children, forwardRef, useCallback, useRef, type ComponentProps } from 'react';
import type * as THREE from 'three';
import { Instances } from '@react-three/drei';
import { useHideWhileEmpty } from '../hooks/useHideWhileEmpty';
import { isProvablyEmptyLayer } from './instanceGuards';

type InstancesProps = ComponentProps<typeof Instances>;

/**
 * drei `<Instances>` that never reaches a renderer with zero instances.
 *
 * drei mounts its InstancedMesh as `args={[null, null, 0]}` and assigns `.count`
 * from its subscribed children in `useFrame`, so **every** layer is born at zero
 * — and three r168's node pipeline cannot compile a zero-count InstancedMesh,
 * permanently, for that object. See
 * [`useHideWhileEmpty`](../hooks/useHideWhileEmpty.ts) for the mechanism; the
 * mesh stays hidden until drei has filled the count in.
 *
 * A provably empty layer (no children, or `range`/`limit` of zero) is not
 * mounted at all. That test is deliberately conservative, so a caller that sizes
 * itself some other way still renders.
 *
 * See also [`NonEmptyInstancedMesh`](./NonEmptyInstancedMesh.tsx) for raw mounts.
 */
export const NonEmptyInstances = forwardRef<
  React.ComponentRef<typeof Instances>,
  InstancesProps
>(function NonEmptyInstances({ children, range, limit, visible = true, ...props }, ref) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  useHideWhileEmpty(meshRef, visible);

  const attach = useCallback(
    (node: THREE.InstancedMesh | null) => {
      meshRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<unknown>).current = node;
    },
    [ref],
  );

  if (isProvablyEmptyLayer({ childCount: Children.count(children), range, limit })) return null;

  return (
    <Instances ref={attach} range={range} limit={limit} visible={false} {...props}>
      {children}
    </Instances>
  );
});
