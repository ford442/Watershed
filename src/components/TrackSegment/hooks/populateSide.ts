import { populateSidePart1 } from './populateSidePart1';
import { populateSidePart2 } from './populateSidePart2';
import type { PopulateSideArgs } from '../types';

export function populateSide(args: PopulateSideArgs): void {
  populateSidePart1(args);
  populateSidePart2(args);
}
