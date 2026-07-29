export interface BiomeLightingConfig {
  ambientIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  dirColor: string;
  dirIntensity: number;
  dirPosition: [number, number, number];
  fillColor: string;
  fillIntensity: number;
}
