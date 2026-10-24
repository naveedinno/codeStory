// Caption length is a reading constraint, not a speech synthesis boundary.
// Match Lino's audio-job batch limit and keep sentences together when possible.
const MAX_BATCH_CHARACTERS = 3500;
export const VIDEO_FPS = 25;
export interface NarrationBatch { text: string; start: number; end: number }
interface Caption { text: string }

export function videoNarrationBatches(scenes: readonly Caption[]): NarrationBatch[] {
  const text = scenes.map(scene => scene.text).join(" ");
  const batches: NarrationBatch[] = [];
  const sentences = new Intl.Segmenter("en", { granularity: "sentence" }).segment(text);
  let start = 0, end = 0;
  const flush = () => {
    if (end > start) batches.push({ text: text.slice(start, end), start, end });
  };
  for (const sentence of sentences) {
    let unitStart = sentence.index;
    const unitEnd = sentence.index + sentence.segment.trimEnd().length;
    while (unitStart < unitEnd) {
      while (text[unitStart] === " ") unitStart++;
      let nextEnd = Math.min(unitEnd, unitStart + MAX_BATCH_CHARACTERS);
      if (nextEnd < unitEnd && text[nextEnd] !== " ") {
        nextEnd = text.lastIndexOf(" ", nextEnd);
        if (nextEnd <= unitStart) throw new Error("A narration word exceeds 3,500 characters. Shorten it or export with subtitles only.");
      }
      if (nextEnd - start > MAX_BATCH_CHARACTERS) { flush(); start = unitStart; }
      end = nextEnd;
      unitStart = nextEnd;
    }
  }
  flush();
  return batches;
}

/**
 * Synthesis supplies a measured duration per batch, not per word. Interpolate
 * caption boundaries within each batch; never cut the audio at those points.
 * Snap visual boundaries to frames, sharing one clock with the finished track.
 */
export function videoNarrationTimings(scenes: readonly Caption[], batches: readonly NarrationBatch[],
  batchSeconds: readonly number[], audioSeconds: number): number[] {
  if (!scenes.length || !batches.length || batchSeconds.length !== batches.length ||
      !Number.isFinite(audioSeconds) || audioSeconds <= 0 ||
      batchSeconds.some(seconds => !Number.isFinite(seconds) || seconds <= 0)) {
    throw new Error("Could not measure the generated narration.");
  }
  const sourceSeconds = batchSeconds.reduce((sum, seconds) => sum + seconds, 0);
  // One final listening tail; no extra silence at caption or batch boundaries.
  const frames = Math.ceil((audioSeconds + 0.6) * VIDEO_FPS);
  if (frames < scenes.length) throw new Error("The generated narration is too short for the story's captions.");
  const ends: number[] = [];
  let offset = 0, batch = 0, elapsed = 0, previousFrame = 0;
  for (let index = 0; index < scenes.length; index++) {
    offset += scenes[index].text.length;
    while (batch < batches.length - 1 && offset > batches[batch].end) elapsed += batchSeconds[batch++];
    const part = batches[batch];
    const fraction = Math.max(0, Math.min(1, (offset - part.start) / (part.end - part.start)));
    const seconds = (elapsed + batchSeconds[batch] * fraction) * audioSeconds / sourceSeconds;
    const frame = index === scenes.length - 1 ? frames
      : Math.max(previousFrame + 1, Math.min(frames - (scenes.length - index - 1), Math.round(seconds * VIDEO_FPS)));
    ends.push(frame * 1000 / VIDEO_FPS);
    previousFrame = frame;
    offset++; // The space joining this caption to the next one.
  }
  return ends;
}
