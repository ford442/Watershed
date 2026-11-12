/** What the weather director broadcasts to the scene each step (GameState.weather). */
export interface WeatherBroadcast {
  type: string;
  intensity: number;
  /** 0–1 progress of the transition into `type`. */
  transition: number;
  /** Water-surface ripple strength (0 = calm). */
  rippleStrength: number;
}
