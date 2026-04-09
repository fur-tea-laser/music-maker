export interface MusicPart {
  partId: number;
  partStart: number;
  partEnd: number;
  partSampleSource: string;
}

export interface RenderMusicLoopApi {
  loopParts: Record<number | string, MusicPart>;
  loopSampleCount: number;
  loopSampleRate: number;
}

export function renderMusicLoop({
  loopParts,
  loopSampleCount,
  loopSampleRate,
}: RenderMusicLoopApi): Uint8Array {
  const headerSize = 56;
  const dataSize = loopSampleCount * 4;
  const wavBuffer = new Uint8Array(headerSize + dataSize);
  const bufferView = new DataView(wavBuffer.buffer);
  // RIFF chunk
  bufferView.setUint32(0, 0x52494646, false); // "RIFF"
  bufferView.setUint32(4, 48 + dataSize, true); // ChunkSize
  bufferView.setUint32(8, 0x57415645, false); // "WAVE"
  // fmt chunk
  bufferView.setUint32(12, 0x666d7420, false); // "fmt "
  bufferView.setUint32(16, 16, true); // Subchunk1Size
  bufferView.setUint16(20, 3, true); // AudioFormat (3 = IEEE Float)
  bufferView.setUint16(22, 1, true); // NumChannels (1 = Mono)
  bufferView.setUint32(24, loopSampleRate, true); // SampleRate
  bufferView.setUint32(28, loopSampleRate * 4, true); // ByteRate
  bufferView.setUint16(32, 4, true); // BlockAlign
  bufferView.setUint16(34, 32, true); // BitsPerSample
  // fact chunk
  bufferView.setUint32(36, 0x66616374, false); // "fact"
  bufferView.setUint32(40, 4, true); // factSize
  bufferView.setUint32(44, loopSampleCount, true); // sampleLength
  // data chunk
  bufferView.setUint32(48, 0x64617461, false); // "data"
  bufferView.setUint32(52, dataSize, true); // dataSize
  // Create a float view of the wav buffer data section for direct summing
  const loopSamples = new Float32Array(wavBuffer.buffer, headerSize, loopSampleCount);
  // 1. Each music part computes their own sample array
  const renderedParts = Object.values(loopParts).map((musicPart) => {
    const compiledFunction = new Function(
      "loopTimestamp",
      "relativeTimestamp",
      `return (${musicPart.partSampleSource})(loopTimestamp, relativeTimestamp)`
    );
    const startIndex = Math.floor(musicPart.partStart * loopSampleCount);
    const endIndex = Math.floor(musicPart.partEnd * loopSampleCount);
    const partLength = Math.max(0, endIndex - startIndex);
    const partSamples = new Float32Array(partLength);
    for (let sampleIndex = 0; sampleIndex < partLength; sampleIndex++) {
      const globalIndex = startIndex + sampleIndex;
      if (globalIndex >= loopSampleCount) break;
      const loopTimestamp = globalIndex / loopSampleCount;
      const relativeTimestamp = partLength > 0 ? sampleIndex / partLength : 0;
      partSamples[sampleIndex] = compiledFunction(loopTimestamp, relativeTimestamp);
    }
    return {
      partSamples,
      startIndex,
    };
  });
  // 2. Combine parts directly into the wav buffer float view
  for (const renderedPart of renderedParts) {
    for (
      let sampleIndex = 0;
      sampleIndex < renderedPart.partSamples.length;
      sampleIndex++
    ) {
      const globalIndex = renderedPart.startIndex + sampleIndex;
      if (globalIndex < loopSampleCount) {
        loopSamples[globalIndex] += renderedPart.partSamples[sampleIndex];
      }
    }
  }
  return wavBuffer;
}
