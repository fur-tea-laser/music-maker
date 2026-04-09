let engineContext: AudioContext | null = null;
let engineSource: AudioBufferSourceNode | null = null;
interface PlayLoopApi {
  apiData: ArrayBuffer;
}
export async function playLoop({ 
  apiData 
}: PlayLoopApi): Promise<void> {
  if (!engineContext) {
    engineContext = new AudioContext();
  }
  if (engineSource) {
    engineSource.stop();
    engineSource.disconnect();
  }
  const decodedBuffer = await engineContext.decodeAudioData(apiData.slice(0));
  engineSource = engineContext.createBufferSource();
  engineSource.buffer = decodedBuffer;
  engineSource.loop = true;
  engineSource.connect(engineContext.destination);
  engineSource.start();
}
export function stopLoop(): void {
  if (engineSource) {
    engineSource.stop();
    engineSource.disconnect();
    engineSource = null;
  }
}
