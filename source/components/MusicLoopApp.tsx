import { useState, useEffect, useRef } from "preact/hooks";
import styles from "../styles/MusicLoopApp.module.scss";
import { playLoop, stopLoop } from "../audio/audioEngine.ts";
import * as esbuild from "esbuild-wasm";

const defaultScriptContent = `return {
  1: {
    partId: 1,
    partStart: 0,
    partEnd: 1,
    getPartSample: (timestamp, relativeTimestamp) => {
      const frequencyValue = 440;
      const amplitudeValue = 0.5;
      return amplitudeValue * Math.sin(timestamp * 2 * Math.PI * frequencyValue);
    }
  }
};`;

export function MusicLoopApp() {
  const [loopLengthSeconds, setLoopLengthSeconds] = useState(1);
  const [sampleRate, setSampleRate] = useState(44100);
  const [scriptContent, setScriptContent] = useState(defaultScriptContent);
  const [isBundling, setIsBundling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const esbuildReadyRef = useRef(false);
  const renderWorkerRef = useRef<Worker | null>(null);
  useEffect(() => {
    const initializeEsbuild = async () => {
      try {
        await esbuild.initialize({
          wasmURL: "/esbuild.wasm",
        });
        esbuildReadyRef.current = true;
      } catch (initializeError) {
        console.error("Failed to initialize esbuild:", initializeError);
        setErrorMessage("Failed to initialize bundler.");
      }
    };
    initializeEsbuild();
    renderWorkerRef.current = new Worker(new URL("./audio/renderWorker.js", import.meta.url), { type: "module" });
    return () => {
      renderWorkerRef.current?.terminate();
    };
  }, []);
  const handlePlayLoop = async () => {
    if (!esbuildReadyRef.current || !renderWorkerRef.current) {
      setErrorMessage("System not ready. Please wait.");
      return;
    }
    setErrorMessage(null);
    setIsBundling(true);
    try {
      const wrappedScript = `export default function() {\n${scriptContent}\n}`;
      const buildResult = await esbuild.transform(wrappedScript, {
        loader: "ts",
        format: "esm",
      });
      setIsBundling(false);
      setIsRendering(true);
      renderWorkerRef.current.onmessage = async (event) => {
        setIsRendering(false);
        if (event.data.renderError) {
          setErrorMessage(`Render Error: ${event.data.renderError}`);
          return;
        }
        const { loopWavBuffer } = event.data;
        await playLoop({ apiData: loopWavBuffer });
      };
      renderWorkerRef.current.onerror = (workerError) => {
        setIsRendering(false);
        setErrorMessage(`Worker Error: ${workerError.message}`);
      };
      renderWorkerRef.current.postMessage({
        scriptContent: buildResult.code,
        loopLengthSeconds: loopLengthSeconds,
        sampleRate: sampleRate,
      });
    } catch (bundleError) {
      setIsBundling(false);
      setErrorMessage(`Bundle Error: ${bundleError instanceof Error ? bundleError.message : String(bundleError)}`);
    }
  };
  const handleStopLoop = () => {
    stopLoop();
  };
  return (
    <div className={styles.appContainer}>
      <header className={styles.appHeader}>
        <div className={styles.headerControl}>
          <label htmlFor="lengthInput">Length (s):</label>
          <input
            id="lengthInput"
            type="number"
            className={styles.headerInput}
            value={loopLengthSeconds}
            onInput={(event) => setLoopLengthSeconds(Number((event.target as HTMLInputElement).value))}
            min={0.1}
            step={0.1}
          />
        </div>
        <div className={styles.headerControl}>
          <label htmlFor="sampleRateSelect">Sample Rate:</label>
          <select
            id="sampleRateSelect"
            className={styles.headerInput}
            value={sampleRate}
            onChange={(event) => setSampleRate(Number((event.target as HTMLSelectElement).value))}
          >
            <option value={44100}>44.1 kHz</option>
            <option value={96000}>96 kHz</option>
            <option value={192000}>192 kHz</option>
          </select>
        </div>
        {errorMessage && <div style={{ color: "#ff8888", fontSize: "12px", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{errorMessage}</div>}
        <div className={styles.playbackControls}>
          <button
            className={styles.playbackButton}
            onClick={handlePlayLoop}
            disabled={isBundling || isRendering}
          >
            {isBundling ? "Bundling..." : isRendering ? "Rendering..." : "Play Loop"}
          </button>
          <button className={styles.playbackButton} onClick={handleStopLoop}>Stop</button>
        </div>
      </header>
      <main className={styles.appBody}>
        <textarea
          className={styles.scriptEditor}
          value={scriptContent}
          onInput={(event) => setScriptContent((event.target as HTMLTextAreaElement).value)}
          spellcheck={false}
        />
      </main>
    </div>
  );
}
