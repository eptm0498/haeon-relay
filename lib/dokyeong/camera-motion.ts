/**
 * Cheap local screen-change heuristic. This does not identify people, faces,
 * gestures or any specific action; Gemini handles visual interpretation.
 * Subtracting global brightness drift makes auto-exposure less likely to count
 * as movement, while comparing per-cell RGB changes detects local motion.
 */
export type VisualMotion = {
  significant: boolean;
  changedFraction: number;
  meanDifference: number;
};

export function measureVisualMotion(previous: number[], current: number[]): VisualMotion {
  const length = current.length;
  if (!length || length !== previous.length || length % 3 !== 0) {
    return { significant: false, changedFraction: 0, meanDifference: 0 };
  }
  let shift = 0;
  for (let i = 0; i < length; i += 3) {
    shift += (current[i] + current[i + 1] + current[i + 2] -
      previous[i] - previous[i + 1] - previous[i + 2]) / 3;
  }
  shift /= length / 3;

  let changed = 0;
  let differenceSum = 0;
  for (let i = 0; i < length; i += 3) {
    const delta = (
      Math.abs(current[i] - previous[i] - shift) +
      Math.abs(current[i + 1] - previous[i + 1] - shift) +
      Math.abs(current[i + 2] - previous[i + 2] - shift)
    ) / 3;
    differenceSum += delta;
    if (delta > 24) changed++;
  }
  const pixels = length / 3;
  const changedFraction = changed / pixels;
  const meanDifference = differenceSum / pixels;
  // Local gestures may affect only a small portion of the picture.
  // Two independent gates reduce reactions to sensor/compression noise.
  return {
    significant: changedFraction >= 0.035 && meanDifference >= 4.5,
    changedFraction,
    meanDifference,
  };
}
