/**
 * sunPosition.ts — where the sun is, from the hour, the latitude and the day.
 *
 * NOAA's solar-position approximation (the fractional-year series for the
 * declination and the equation of time), without longitude or time zone: the
 * game hour is local solar-mean time, so 12:00 is within a few minutes of
 * solar noon. Good to a fraction of a degree, which is far finer than a sky
 * needs, and ~60 lines instead of a dependency.
 *
 * World frame: +X east, +Y up, −Z north. The river runs downstream toward −Z,
 * so the noon sun of a northern-hemisphere map stands behind the player.
 *
 * Pure and allocation-free when given an `out`.
 */

const DEG = Math.PI / 180;
/** Altitude of the sun's centre at apparent sunrise/sunset (refraction + disc). */
const HORIZON_ALTITUDE_RAD = -0.833 * DEG;

export interface SunSample {
  /** Unit vector toward the sun in world space. */
  x: number;
  y: number;
  z: number;
  /** Altitude above the horizon (radians; negative at night). */
  elevation: number;
  /** Compass bearing, clockwise from north (radians, 0..2π). */
  azimuth: number;
  /** Hour angle (radians): negative before solar noon, positive after. */
  hourAngle: number;
}

export function createSunSample(): SunSample {
  return { x: 0, y: 1, z: 0, elevation: Math.PI / 2, azimuth: 0, hourAngle: 0 };
}

/** NOAA fractional year γ (radians) for `dayOfYear` (1..365) at `hour`. */
function fractionalYear(dayOfYear: number, hour: number): number {
  return ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);
}

/** Solar declination (radians). */
export function solarDeclination(dayOfYear: number, hour = 12): number {
  const g = fractionalYear(dayOfYear, hour);
  return (
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  );
}

/** Equation of time (minutes): true solar time minus mean solar time. */
export function equationOfTime(dayOfYear: number, hour = 12): number {
  const g = fractionalYear(dayOfYear, hour);
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g))
  );
}

/** The sun at `hour` (0..24, may run past 24) for `latitudeDeg` on `dayOfYear`. */
export function sunPosition(hour: number, latitudeDeg: number, dayOfYear: number, out: SunSample = createSunSample()): SunSample {
  const h = ((hour % 24) + 24) % 24;
  const phi = latitudeDeg * DEG;
  const decl = solarDeclination(dayOfYear, h);
  const trueSolarMinutes = h * 60 + equationOfTime(dayOfYear, h);
  const H = (trueSolarMinutes / 4 - 180) * DEG;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinDec = Math.sin(decl);
  const cosDec = Math.cos(decl);
  const cosH = Math.cos(H);
  const up = sinPhi * sinDec + cosPhi * cosDec * cosH;
  const east = -cosDec * Math.sin(H);
  const north = cosPhi * sinDec - sinPhi * cosDec * cosH;

  out.x = east;
  out.y = up;
  out.z = -north;
  out.elevation = Math.asin(Math.max(-1, Math.min(1, up)));
  const azimuth = Math.atan2(east, north);
  out.azimuth = azimuth < 0 ? azimuth + 2 * Math.PI : azimuth;
  out.hourAngle = H > Math.PI ? H - 2 * Math.PI : H;
  return out;
}

export interface DaylightSpan {
  /** Hours (mean solar time) of apparent sunrise and sunset. */
  sunrise: number;
  sunset: number;
}

/**
 * Apparent sunrise and sunset. A polar day spans 0–24; a polar night
 * collapses to solar noon (sunrise = sunset).
 */
export function daylightSpan(latitudeDeg: number, dayOfYear: number): DaylightSpan {
  const phi = latitudeDeg * DEG;
  const decl = solarDeclination(dayOfYear);
  const cosH0 = (Math.sin(HORIZON_ALTITUDE_RAD) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
  const noon = 12 - equationOfTime(dayOfYear) / 60;
  if (cosH0 <= -1) return { sunrise: 0, sunset: 24 };
  if (cosH0 >= 1) return { sunrise: noon, sunset: noon };
  const halfDay = Math.acos(cosH0) / DEG / 15;
  return { sunrise: noon - halfDay, sunset: noon + halfDay };
}

/**
 * The hour as a fraction of the daylight span: 0 at sunrise, 0.5 near solar
 * noon, 1 at sunset; below 0 before dawn and above 1 after dusk, clamped to
 * [−0.5, 1.5]. This is the `timeOfDay` the scene's day-arc consumers read
 * (they were written for "0 = sunrise, 1 = sunset").
 */
export function daylightFraction(hour: number, span: DaylightSpan): number {
  const h = ((hour % 24) + 24) % 24;
  const length = span.sunset - span.sunrise;
  if (!(length > 0)) return 1.5;
  // Measure from the sunrise nearest the hour, so 23:00 reads late, not early.
  let fromSunrise = h - span.sunrise;
  if (fromSunrise < -6) fromSunrise += 24;
  const fraction = fromSunrise / length;
  return Math.max(-0.5, Math.min(1.5, fraction));
}
