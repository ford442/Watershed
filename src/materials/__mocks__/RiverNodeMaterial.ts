export function createRiverNodeMaterial() {
  return makeRiverMaterial();
}

export function copyStandardPropsToRiverMaterial() {
  return makeRiverMaterial();
}

export function updateRiverNodeMaterial(
  material: { userData: { riverUniforms: Record<string, { value: number }> } },
  time: number,
  options: { waterLevel?: number; weatherWetness?: number } | number = {}
) {
  const refs = material.userData.riverUniforms;
  refs.uTime.value = time;
  if (typeof options === 'number') {
    refs.uWaterLevel.value = options;
  } else if (options && typeof options === 'object') {
    if (options.waterLevel !== undefined) refs.uWaterLevel.value = options.waterLevel;
    if (options.weatherWetness !== undefined) refs.uWeatherWetness.value = options.weatherWetness;
  }
}

function makeRiverMaterial() {
  return {
    isNodeMaterial: true,
    userData: {
      riverUniforms: {
        uTime: { value: 0 },
        uWaterLevel: { value: 13 },
        uWetnessRange: { value: 4 },
        uWeatherWetness: { value: 0 },
      },
    },
  };
}
