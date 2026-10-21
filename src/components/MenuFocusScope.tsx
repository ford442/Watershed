/**
 * MenuFocusScope.tsx — a `div` whose controls are navigable by arrow keys and
 * the gamepad d-pad (#486 B).
 *
 * `useMenuFocus` is a hook, and overlays that return early from a larger
 * component (the wipeout / journey-complete cards in GameHUD) cannot call a hook
 * after that return. This wraps the hook in a component so they can mount it
 * where they render.
 */

import React, { useRef } from 'react';
import { useMenuFocus } from '../hooks/useMenuFocus';

export interface MenuFocusScopeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gamepad Start. */
  onStart?: () => void;
  /** Gamepad B. */
  onBack?: () => void;
}

export const MenuFocusScope: React.FC<MenuFocusScopeProps> = ({ onStart, onBack, children, ...rest }) => {
  const ref = useRef<HTMLDivElement>(null);
  useMenuFocus(ref, { onStart, onBack });
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  );
};

export default MenuFocusScope;
