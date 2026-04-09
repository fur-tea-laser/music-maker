import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderMusicLoop, MusicPart } from "./renderMusicLoop.ts";

Deno.test("renderMusicLoop - returns valid wav header", () => {
  const loopParts: Record<number, MusicPart> = {
    1: {
      partId: 1,
      partStart: 0,
      partEnd: 1,
      partSampleSource: "(t) => 0.5",
    },
  };
  const loopSampleCount = 10;
  const loopSampleRate = 44100;
  const resultWav = renderMusicLoop({ loopParts, loopSampleCount, loopSampleRate });
  const bufferView = new DataView(resultWav.buffer);
  assertEquals(bufferView.getUint32(0, false), 0x52494646);
  assertEquals(bufferView.getUint32(8, false), 0x57415645);
  assertEquals(bufferView.getUint16(20, true), 3);
  assertEquals(bufferView.getUint32(24, true), 44100);
  assertEquals(bufferView.getUint32(52, true), loopSampleCount * 4);
  assertEquals(bufferView.getFloat32(56, true), 0.5);
});

Deno.test("renderMusicLoop - handles relativeTimestamp", () => {
  const loopParts: Record<number, MusicPart> = {
    1: {
      partId: 1,
      partStart: 0.5,
      partEnd: 1.0,
      partSampleSource: "(t, rt) => rt",
    },
  };
  const loopSampleCount = 10;
  const loopSampleRate = 44100;
  const resultWav = renderMusicLoop({ loopParts, loopSampleCount, loopSampleRate });
  const bufferView = new DataView(resultWav.buffer);
  // Header is 56 bytes. loopSampleCount 10. partStart 0.5 means index 5.
  // Sample at index 5: relativeTimestamp = 0 / 5 = 0.
  assertAlmostEquals(bufferView.getFloat32(56 + 5 * 4, true), 0);
  // Sample at index 6: relativeTimestamp = 1 / 5 = 0.2.
  assertAlmostEquals(bufferView.getFloat32(56 + 6 * 4, true), 0.2);
  // Sample at index 9: relativeTimestamp = 4 / 5 = 0.8.
  assertAlmostEquals(bufferView.getFloat32(56 + 9 * 4, true), 0.8);
});
