/** A campaign map's display name in the current locale (#566 A). */

import { MAP_REGISTRY, type MapRegistryId } from '../maps/registry';
import { t } from './i18n';

export const mapLabel = (id: MapRegistryId): string => t(MAP_REGISTRY[id].labelKey ?? `map.${id}`);
