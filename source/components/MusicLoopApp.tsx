import { JSX } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import styles from "../styles/MusicLoopApp.module.scss";
import { playLoop, stopLoop } from "../audio/audioEngine.ts";
import * as esbuild from "esbuild-wasm";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";

interface ProjectFile {
  fileName: string;
  fileContent: string;
}

const STORAGE_KEY = "music-loop-project-v1";

const defaultMainFile: ProjectFile = {
  fileName: "main.js",
  fileContent: `import { getSineWave } from "./utils.js";

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
  fileName: "utils.js",
  fileContent: `export function getSineWave(timestamp, frequency, amplitude) {
  return amplitude * Math.sin(timestamp * 2 * Math.PI * frequency);
}`
};

interface SavedProject {
  loopLengthSeconds: number;
  sampleRate: number;
  projectFiles: ProjectFile[];
  activeFileName: string;
}

export function MusicLoopApp() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loopLengthSeconds, setLoopLengthSeconds] = useState(1);
  const [sampleRate, setSampleRate] = useState(44100);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([defaultMainFile, defaultUtilsFile]);
  const [activeFileName, setActiveFileName] = useState<string>("main.js");
  const [isBundling, setIsBundling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const esbuildReadyRef = useRef(false);
  const loopWavWorkerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeFile = projectFiles.find(file => file.fileName === activeFileName) || projectFiles[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
      try {
        const parsed: SavedProject = JSON.parse(savedData);
        setLoopLengthSeconds(parsed.loopLengthSeconds);
        setSampleRate(parsed.sampleRate);
        setProjectFiles(parsed.projectFiles);
        setActiveFileName(parsed.activeFileName);
      } catch (e) {
        console.error("Failed to load project from localStorage", e);
      }
    }
    setIsLoaded(true);

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
    loopWavWorkerRef.current = new Worker(new URL("./audio/loopWavWorker.js", import.meta.url), { type: "module" });
    return () => {
      loopWavWorkerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const projectToSave: SavedProject = {
      loopLengthSeconds,
      sampleRate,
      projectFiles,
      activeFileName,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projectToSave));
  }, [loopLengthSeconds, sampleRate, projectFiles, activeFileName, isLoaded]);

  const handleUpdateFileContent = (content: string) => {
    setProjectFiles(prev => prev.map(file => 
      file.fileName === activeFileName ? { ...file, fileContent: content } : file
    ));
  };

  const handleAddFile = () => {
    const newName = prompt("Enter file name (e.g. utils.js):");
    if (newName) {
      const sanitizedName = newName.endsWith(".js") ? newName : `${newName}.js`;
      if (!projectFiles.find(f => f.fileName === sanitizedName)) {
        setProjectFiles(prev => [...prev, { fileName: sanitizedName, fileContent: "" }]);
        setActiveFileName(sanitizedName);
      }
    }
  };

  const handleDeleteFile = (fileName: string) => {
    if (fileName === "main.js") return;
    if (confirm(`Delete ${fileName}?`)) {
      setProjectFiles(prev => prev.filter(f => f.fileName !== fileName));
      if (activeFileName === fileName) {
        setActiveFileName("main.js");
      }
    }
  };

  const handleRenderLoop = async (onRenderComplete: (wavBuffer: ArrayBuffer) => void) => {
    if (!esbuildReadyRef.current || !loopWavWorkerRef.current) {
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
              return { contents: file.fileContent, loader: "js" };
            }
            return null;
          });
        }
      };

      const buildResult = await esbuild.build({
        entryPoints: ["main.js"],
        bundle: true,
        write: false,
        format: "esm",
        plugins: [plugin],
      });

      const bundleCode = buildResult.outputFiles![0].text;

      setIsBundling(false);
      setIsRendering(true);
      loopWavWorkerRef.current.onmessage = (event) => {
        setIsRendering(false);
        if (event.data.renderError) {
          setErrorMessage(`Render Error: ${event.data.renderError}`);
          return;
        }
        onRenderComplete(event.data.loopWavBuffer);
      };
      loopWavWorkerRef.current.onerror = (workerError) => {
        setIsRendering(false);
        setErrorMessage(`Worker Error: ${workerError.message}`);
      };
      loopWavWorkerRef.current.postMessage({
        scriptContent: bundleCode,
        loopLengthSeconds: loopLengthSeconds,
        sampleRate: sampleRate,
      });
    } catch (bundleError) {
      setIsBundling(false);
      setErrorMessage(`Bundle Error: ${bundleError instanceof Error ? bundleError.message : String(bundleError)}`);
    }
  };

  const handlePlayLoop = async () => {
    await handleRenderLoop(async (wavBuffer) => {
      await playLoop({ apiData: wavBuffer });
    });
  };

  const handleDownloadLoop = async () => {
    await handleRenderLoop((wavBuffer) => {
      const blob = new Blob([wavBuffer], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "music-loop.wav";
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };

  const handleStopLoop = () => {
    stopLoop();
  };

  const handleArchiveProject = () => {
    const archiveData: Record<string, Uint8Array> = {};
    const metadata = {
      loopLengthSeconds,
      sampleRate,
      activeFileName,
    };
    archiveData["project.json"] = strToU8(JSON.stringify(metadata));
    for (const file of projectFiles) {
      archiveData[file.fileName] = strToU8(file.fileContent);
    }
    const zipped = zipSync(archiveData);
    const blob = new Blob([zipped as Uint8Array<ArrayBuffer>], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "music-loop-project.zip";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadArchive = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (result instanceof ArrayBuffer) {
        try {
          const unzipped = unzipSync(new Uint8Array(result));
          const projectJsonBytes = unzipped["project.json"];
          if (!projectJsonBytes) {
            setErrorMessage("Invalid archive: project.json missing.");
            return;
          }
          const metadata = JSON.parse(strFromU8(projectJsonBytes));
          const newFiles: ProjectFile[] = [];
          for (const [fileName, fileBytes] of Object.entries(unzipped)) {
            if (fileName === "project.json") continue;
            newFiles.push({
              fileName,
              fileContent: strFromU8(fileBytes),
            });
          }
          setLoopLengthSeconds(metadata.loopLengthSeconds);
          setSampleRate(metadata.sampleRate);
          setProjectFiles(newFiles);
          setActiveFileName(metadata.activeFileName || "main.js");
          setErrorMessage(null);
        } catch (error) {
          console.error("Failed to load archive", error);
          setErrorMessage("Failed to load archive.");
        }
      }
    };
    reader.readAsArrayBuffer(file);
    input.value = "";
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const textarea = event.currentTarget;
      const { selectionStart, selectionEnd, value } = textarea;
      const newValue = value.substring(0, selectionStart) + "  " + value.substring(selectionEnd);
      
      setProjectFiles(prev => prev.map(file => 
        file.fileName === activeFileName ? { ...file, fileContent: newValue } : file
      ));

      // Re-set selection after state update
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      }, 0);
    }
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
            {isBundling ? "Bundling..." : isRendering ? "Rendering..." : "Loop"}
          </button>
          <button className={styles.playbackButton} onClick={handleStopLoop}>Stop</button>
          
          <div className={styles.externalDropdown} ref={dropdownRef}>
            <button 
              className={styles.playbackButton} 
              onClick={() => setShowDropdown(!showDropdown)}
              style={{ marginLeft: "10px" }}
            >
              External ▾
            </button>
            {showDropdown && (
              <div className={styles.dropdownMenu}>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => { handleDownloadLoop(); setShowDropdown(false); }}
                  disabled={isBundling || isRendering}
                >
                  Download WAV
                </button>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => { handleArchiveProject(); setShowDropdown(false); }}
                >
                  Download Archive
                </button>
                <button 
                  className={styles.dropdownItem} 
                  onClick={() => { fileInputRef.current?.click(); setShowDropdown(false); }}
                >
                  Load Archive
                </button>
              </div>
            )}
          </div>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            accept=".zip"
            onChange={handleLoadArchive}
          />
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
                {file.fileName !== "main.js" && (
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
            onKeyDown={handleKeyDown}
            spellcheck={false}
          />
        </div>
      </main>
    </div>
  );
}
