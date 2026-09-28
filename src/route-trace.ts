export type TraceLeg = 'outbound' | 'return' | null;

/** Number of points at each end that retrace the same path in reverse. */
export function sharedStickPoints(points: readonly (readonly number[])[]): number {
  let count = 0;
  while (count < Math.floor(points.length / 2) &&
    points[count][0] === points[points.length - 1 - count][0] &&
    points[count][1] === points[points.length - 1 - count][1]) count++;
  return count;
}

export function resolveTrace(
  segment: number, t: number, distances: readonly number[], sharedPoints: number,
  currentProgress: number, leg: TraceLeg, outwardMovement: number,
): { progress: number; leg: TraceLeg } {
  const lastSegment = distances.length - 2;
  const total = distances.at(-1)!;
  const at = (i: number, fraction: number) =>
    (distances[i] + (distances[i + 1] - distances[i]) * fraction) / total;
  const sharedSegmentCount = sharedPoints - 1;
  if (segment >= sharedSegmentCount && segment <= lastSegment - sharedSegmentCount) {
    return { progress: at(segment, t), leg: null };
  }

  // The return half of the stick is the same geometry in reverse.
  const outwardSegment = Math.min(segment, lastSegment - segment);
  const outwardT = segment === outwardSegment ? t : 1 - t;
  const outboundProgress = at(outwardSegment, outwardT);
  const returnProgress = at(lastSegment - outwardSegment, 1 - outwardT);
  const direction = Math.abs(outwardMovement) >= total * 0.002 ? Math.sign(outwardMovement) : 0;
  let chosenLeg = leg;
  // Near either end of the stick, a deliberate reversal can start a new trace.
  // Elsewhere keep the current leg stable through small backward movements.
  const sharedEnd = distances[sharedPoints - 1] / total;
  const endZone = Math.min(0.06, sharedEnd / 4);
  if (chosenLeg && Math.abs(outwardMovement) >= total * 0.004 &&
      (outboundProgress < endZone || outboundProgress > sharedEnd - endZone)) {
    chosenLeg = direction > 0 ? 'outbound' : 'return';
  }
  if (!chosenLeg) {
    if (direction) chosenLeg = direction > 0 ? 'outbound' : 'return';
    else return {
      progress: Math.abs(currentProgress - outboundProgress) <= Math.abs(currentProgress - returnProgress)
        ? outboundProgress : returnProgress,
      leg: null,
    };
  }
  return { progress: chosenLeg === 'outbound' ? outboundProgress : returnProgress, leg: chosenLeg };
}
