import { useState, useEffect, useRef } from "preact/hooks";
import styles from "../styles/MusicLoopApp.module.scss";
import { playLoop, stopLoop } from "../audio/audioEngine.ts";
import * as esbuild from "esbuild-wasm";

interface ProjectFile {
  fileName: string;
  fileContent: string;
}

const defaultMainFile: ProjectFile = {
  fileName: "main.ts",
  fileContent: `import { getSineWave } from "./utils.ts";

export default function() {
  return {
    1: {
      partId: 1,
      partStart: 0,
      partEnd: 1,
      getPartSample: (timestamp, relativeTimestamp) => {
        return getSineWave(timestamp, 440, 0.5);
      }
    }
  };
};`
};

const defaultUtilsFile: ProjectFile = {
  fileName: "utils.ts",
  fileContent: `export function getSineWave(timestamp: number, frequency: number, amplitude: number): number {
  return amplitude * Math.sin(timestamp * 2 * Math.PI * frequency);
}`
};

export function MusicLoopApp() {
  const [loopLengthSeconds, setLoopLengthSeconds] = useState(1);
  const [sampleRate, setSampleRate] = useState(44100);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([defaultMainFile, defaultUtilsFile]);
  const [activeFileName, setActiveFileName] = useState<string>("main.ts");
  const [isBundling, setIsBundling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const esbuildReadyRef = useRef(false);
  const renderWorkerRef = useRef<Worker | null>(null);

  const activeFile = projectFiles.find(file => file.fileName === activeFileName) || projectFiles[0];

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

  const handleUpdateFileContent = (content: string) => {
    setProjectFiles(prev => prev.map(file => 
      file.fileName === activeFileName ? { ...file, fileContent: content } : file
    ));
  };

  const handleAddFile = () => {
    const newName = prompt("Enter file name (e.g. utils.ts):");
    if (newName && !projectFiles.find(f => f.fileName === newName)) {
      setProjectFiles(prev => [...prev, { fileName: newName, fileContent: "" }]);
      setActiveFileName(newName);
    }
  };

  const handleDeleteFile = (fileName: string) => {
    if (fileName === "main.ts") return;
    if (confirm(`Delete ${fileName}?`)) {
      setProjectFiles(prev => prev.filter(f => f.fileName !== fileName));
      if (activeFileName === fileName) {
        setActiveFileName("main.ts");
      }
    }
  };

  const handlePlayLoop = async () => {
    if (!esbuildReadyRef.current || !renderWorkerRef.current) {
      setErrorMessage("System not ready. Please wait.");
      return;
    }
    setErrorMessage(null);
    setIsBundling(true);

    try {
      const plugin: esbuild.Plugin = {
        name: "virtual-fs",
        setup(build) {
          build.onResolve({ filter: /.*/ }, args => {
            if (args.path.startsWith("./")) {
              return { path: args.path.replace("./", ""), namespace: "virtual" };
            }
            if (projectFiles.find(f => f.fileName === args.path)) {
              return { path: args.path, namespace: "virtual" };
            }
            return null;
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, args => {
            const file = projectFiles.find(f => f.fileName === args.path);
            if (file) {
              return { contents: file.fileContent, loader: "ts" };
            }
            return null;
          });
        }
      };

      const buildResult = await esbuild.build({
        entryPoints: ["main.ts"],
        bundle: true,
        write: false,
        format: "esm",
        plugins: [plugin],
      });

      const bundleCode = buildResult.outputFiles![0].text;

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
        scriptContent: bundleCode,
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
        <aside className={styles.fileExplorer}>
          <div className={styles.explorerHeader}>
            Files
            <button className={styles.addFileButton} onClick={handleAddFile}>+</button>
          </div>
          <div className={styles.fileList}>
            {projectFiles.map(file => (
              <div 
                key={file.fileName} 
                className={`${styles.fileItem} ${activeFileName === file.fileName ? styles.fileItemActive : ""}`}
                onClick={() => setActiveFileName(file.fileName)}
              >
                <span>{file.fileName}</span>
                {file.fileName !== "main.ts" && (
                  <button 
                    className={styles.deleteFileButton} 
                    onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.fileName); }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </aside>
        <div className={styles.editorContainer}>
          <textarea
            className={styles.scriptEditor}
            value={activeFile?.fileContent || ""}
            onInput={(event) => handleUpdateFileContent((event.target as HTMLTextAreaElement).value)}
            spellcheck={false}
          />
        </div>
      </main>
    </div>
  );
}
