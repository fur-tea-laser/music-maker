export interface LoopPart {
  partId: number;
  partStart: number;
  partEnd: number;
  getPartSample: (timestamp: number, relativeTimestamp: number) => number;
}
export interface GetLoopWavApi {
  loopParts: Record<number, LoopPart>;
  loopSampleCount: number;
  loopSampleRate: number;
}
export function getLoopWav({
  loopParts,
  loopSampleCount,
  loopSampleRate,
}: GetLoopWavApi): Uint8Array<ArrayBuffer> {
  const headerSize = 56;
  const dataSize = loopSampleCount * 4;
  const wavFile = new Uint8Array(headerSize + dataSize);
  const fileView = new DataView(wavFile.buffer);
  fileView.setUint32(0, 0x52494646, false); // "RIFF"
  fileView.setUint32(4, 48 + dataSize, true); // ChunkSize
  fileView.setUint32(8, 0x57415645, false); // "WAVE"
  fileView.setUint32(12, 0x666d7420, false); // "fmt "
  fileView.setUint32(16, 16, true); // Subchunk1Size
  fileView.setUint16(20, 3, true); // AudioFormat (3 = IEEE Float)
  fileView.setUint16(22, 1, true); // NumChannels (1 = Mono)
  fileView.setUint32(24, loopSampleRate, true); // SampleRate
  fileView.setUint32(28, loopSampleRate * 4, true); // ByteRate
  fileView.setUint16(32, 4, true); // BlockAlign
  fileView.setUint16(34, 32, true); // BitsPerSample
  fileView.setUint32(36, 0x66616374, false); // "fact"
  fileView.setUint32(40, 4, true); // factSize
  fileView.setUint32(44, loopSampleCount, true); // sampleLength
  fileView.setUint32(48, 0x64617461, false); // "data"
  fileView.setUint32(52, dataSize, true); // dataSize
  const loopSamples = new Float32Array(wavFile.buffer, headerSize, loopSampleCount);
  const renderedParts = Object.values(loopParts).map((musicPart) => {
    const startIndex = Math.floor(musicPart.partStart * loopSampleCount);
    const endIndex = Math.floor(musicPart.partEnd * loopSampleCount);
    const partLength = Math.max(0, endIndex - startIndex);
    const partSamples = new Float32Array(partLength);
    for (let sampleIndex = 0; sampleIndex < partLength; sampleIndex++) {
      const globalIndex = startIndex + sampleIndex;
      if (globalIndex >= loopSampleCount) break;
      const timestamp = globalIndex / loopSampleRate;
      const relativeTimestamp = sampleIndex / loopSampleRate;
      partSamples[sampleIndex] = musicPart.getPartSample(timestamp, relativeTimestamp);
    }
    return {
      partSamples,
      startIndex,
    };
  });
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
  return wavFile;
}
