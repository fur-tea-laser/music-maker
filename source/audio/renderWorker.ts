/// <reference lib="webworker" />
import { getLoopWav, type LoopPart } from "./getLoopWav.ts";

onmessage = async (event: MessageEvent) => {
  const { 
    scriptContent, 
    loopLengthSeconds, 
    sampleRate 
  } = event.data;
  try {
    const blob = new Blob([scriptContent], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    const module = await import(blobUrl);
    URL.revokeObjectURL(blobUrl);
    const scriptFunction = module.default;
    const loopPartsResult: Record<number, LoopPart> = scriptFunction();
    const loopSampleCount = Math.floor(loopLengthSeconds * sampleRate);
    const loopWavBuffer = getLoopWav({
      loopParts: loopPartsResult,
      loopSampleCount: loopSampleCount,
      loopSampleRate: sampleRate,
    });
    postMessage({ 
      loopWavBuffer: loopWavBuffer.buffer 
    }, [loopWavBuffer.buffer]);
  } catch (renderError) {
    postMessage({ 
      renderError: renderError instanceof Error ? renderError.message : String(renderError) 
    });
  }
};
