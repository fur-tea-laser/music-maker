import { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import styles from "../styles/MusicLoopApp.module.scss";
import { playLoop, stopLoop } from "../audio/audioEngine.ts";
import * as esbuild from "esbuild-wasm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { WaveformEditor } from "./WaveformEditor.tsx";

interface ProjectFile {
  fileName: string;
  fileContent: string;
}

interface ProjectSample {
  sampleName: string;
  sampleData: ArrayBuffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[],
    );
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
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
      getPartSample: (timestamp, relativeTimestamp, localTimestamp, globalRelativeTimestamp, partRelativeDuration) => {
        return getSineWave(timestamp, 440, 0.5);
      }
    }
  };
};`,
};

const defaultUtilsFile: ProjectFile = {
  fileName: "utils.js",
  fileContent: `export function getSineWave(timestamp, frequency, amplitude) {
  return amplitude * Math.sin(timestamp * 2 * Math.PI * frequency);
}`,
};

interface SavedProject {
  loopLengthSeconds: number;
  sampleRate: number;
  projectFiles: ProjectFile[];
  projectSamples?: { sampleName: string; sampleData: string }[];
  activeFileName: string | null;
  activeSampleName?: string | null;
}

export function MusicLoopApp() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loopLengthSeconds, setLoopLengthSeconds] = useState(1);
  const [sampleRate, setSampleRate] = useState(44100);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([
    defaultMainFile,
    defaultUtilsFile,
  ]);
  const [projectSamples, setProjectSamples] = useState<ProjectSample[]>([]);
  const [activeFileName, setActiveFileName] = useState<string | null>(
    "main.js",
  );
  const [activeSampleName, setActiveSampleName] = useState<string | null>(null);
  const [isBundling, setIsBundling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSampleRateDropdown, setShowSampleRateDropdown] = useState(false);
  const [editingFileName, setEditingFileName] = useState<string | null>(null);
  const [editingSampleName, setEditingSampleName] = useState<string | null>(
    null,
  );
  const [tempFileName, setTempFileName] = useState("");
  const esbuildReadyRef = useRef(false);
  const loopWavWorkerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const sampleRateDropdownRef = useRef<HTMLDivElement>(null);
  const fileNameInputRef = useRef<HTMLInputElement>(null);

  const activeFile =
    projectFiles.find((file) => file.fileName === activeFileName) ||
    projectFiles[0];
  const activeSample =
    projectSamples.find((sample) => sample.sampleName === activeSampleName) ||
    null;

  useEffect(() => {
    if ((editingFileName || editingSampleName) && fileNameInputRef.current) {
      const input = fileNameInputRef.current;
      input.focus();
      const value = input.value;
      const lastDotIndex = value.lastIndexOf(".");
      if (lastDotIndex > 0) {
        input.setSelectionRange(0, lastDotIndex);
      } else {
        // @ts-ignore: select() exists on HTMLInputElement
        input.select();
      }
    }
  }, [editingFileName, editingSampleName]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setShowDropdown(false);
      }
      if (
        sampleRateDropdownRef.current &&
        !sampleRateDropdownRef.current.contains(target)
      ) {
        setShowSampleRateDropdown(false);
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
        if (parsed.projectSamples) {
          setProjectSamples(parsed.projectSamples.map((ps) => ({
            sampleName: ps.sampleName,
            sampleData: base64ToArrayBuffer(ps.sampleData),
          })));
        }
        setActiveFileName(parsed.activeFileName);
        if (parsed.activeSampleName) {
          setActiveSampleName(parsed.activeSampleName);
        }
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
    loopWavWorkerRef.current = new Worker(
      new URL("./audio/loopWavWorker.js", import.meta.url),
      { type: "module" },
    );
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
      activeSampleName,
    };
    try {
      projectToSave.projectSamples = projectSamples.map((ps) => ({
        sampleName: ps.sampleName,
        sampleData: arrayBufferToBase64(ps.sampleData),
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projectToSave));
    } catch (e) {
      console.warn("Storage quota exceeded or error saving samples", e);
      // Fallback: save without samples if quota exceeded
      delete projectToSave.projectSamples;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projectToSave));
    }
  }, [
    loopLengthSeconds,
    sampleRate,
    projectFiles,
    projectSamples,
    activeFileName,
    activeSampleName,
    isLoaded,
  ]);

  const handleUpdateFileContent = (content: string) => {
    setProjectFiles((prev) =>
      prev.map((file) =>
        file.fileName === activeFileName
          ? { ...file, fileContent: content }
          : file
      )
    );
  };

  const handleAddFile = () => {
    let baseName = "untitled";
    let counter = 0;
    let newName = `${baseName}.js`;

    while (projectFiles.some((f) => f.fileName === newName)) {
      counter++;
      newName = `${baseName}_${counter}.js`;
    }

    setProjectFiles(
      (prev) => [...prev, { fileName: newName, fileContent: "" }],
    );
    setActiveFileName(newName);
    setActiveSampleName(null);
    setEditingFileName(newName);
    setTempFileName(newName);
  };

  const handleAddSample = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (result instanceof ArrayBuffer) {
        let newName = file.name;
        let counter = 0;
        while (projectSamples.some((s) => s.sampleName === newName)) {
          counter++;
          const nameParts = file.name.split(".");
          const ext = nameParts.length > 1 ? `.${nameParts.pop()}` : "";
          newName = `${nameParts.join(".")}_${counter}${ext}`;
        }
        setProjectSamples(
          (prev) => [...prev, { sampleName: newName, sampleData: result }],
        );
        setActiveSampleName(newName);
        setActiveFileName(null);
      }
    };
    reader.readAsArrayBuffer(file);
    input.value = "";
  };

  const handleCropSample = (sampleName: string, newBuffer: ArrayBuffer) => {
    setProjectSamples((prev) =>
      prev.map((s) =>
        s.sampleName === sampleName ? { ...s, sampleData: newBuffer } : s
      )
    );
  };

  const handleDeleteSample = (sampleName: string) => {
    if (confirm(`Delete ${sampleName}?`)) {
      setProjectSamples((prev) =>
        prev.filter((s) => s.sampleName !== sampleName)
      );
      if (activeSampleName === sampleName) {
        setActiveSampleName(null);
        if (projectFiles.length > 0) {
          setActiveFileName(projectFiles[0].fileName);
        }
      }
    }
  };

  const handleStartRename = (fileName: string) => {
    if (fileName === "main.js") return;
    setEditingFileName(fileName);
    setTempFileName(fileName);
  };

  const handleFinishRename = () => {
    if (!editingFileName) return;

    const sanitized = tempFileName.trim();
    if (sanitized === "" || sanitized === editingFileName) {
      setEditingFileName(null);
      return;
    }

    const finalName = sanitized.endsWith(".js") ? sanitized : `${sanitized}.js`;

    if (
      projectFiles.some((f) =>
        f.fileName === finalName && f.fileName !== editingFileName
      )
    ) {
      setErrorMessage(`A file named ${finalName} already exists.`);
      setEditingFileName(null);
      return;
    }

    setProjectFiles((prev) =>
      prev.map((f) =>
        f.fileName === editingFileName ? { ...f, fileName: finalName } : f
      )
    );

    if (activeFileName === editingFileName) {
      setActiveFileName(finalName);
    }

    setEditingFileName(null);
  };

  const handleStartRenameSample = (sampleName: string) => {
    setEditingSampleName(sampleName);
    setTempFileName(sampleName);
  };

  const handleFinishRenameSample = () => {
    if (!editingSampleName) return;

    const sanitized = tempFileName.trim();
    if (sanitized === "" || sanitized === editingSampleName) {
      setEditingSampleName(null);
      return;
    }

    const finalName = sanitized.endsWith(".wav")
      ? sanitized
      : `${sanitized}.wav`;

    if (
      projectSamples.some((s) =>
        s.sampleName === finalName && s.sampleName !== editingSampleName
      )
    ) {
      setErrorMessage(`A sample named ${finalName} already exists.`);
      setEditingSampleName(null);
      return;
    }

    setProjectSamples((prev) =>
      prev.map((s) =>
        s.sampleName === editingSampleName ? { ...s, sampleName: finalName } : s
      )
    );

    if (activeSampleName === editingSampleName) {
      setActiveSampleName(finalName);
    }

    setEditingSampleName(null);
  };

  const handleDuplicateSample = (sampleName: string) => {
    const sample = projectSamples.find((s) => s.sampleName === sampleName);
    if (!sample) return;

    const nameParts = sampleName.split(".");
    const ext = nameParts.length > 1 ? `.${nameParts.pop()}` : ".wav";
    const baseName = nameParts.join(".");

    let newName = `${baseName}_copy${ext}`;
    let counter = 0;
    while (projectSamples.some((s) => s.sampleName === newName)) {
      counter++;
      newName = `${baseName}_copy_${counter}${ext}`;
    }

    setProjectSamples((prev) => [
      ...prev,
      { sampleName: newName, sampleData: sample.sampleData.slice(0) },
    ]);
    setActiveSampleName(newName);
    setActiveFileName(null);
  };

  const handleDeleteFile = (fileName: string) => {
    if (fileName === "main.js") return;
    if (confirm(`Delete ${fileName}?`)) {
      setProjectFiles((prev) => prev.filter((f) => f.fileName !== fileName));
      if (activeFileName === fileName) {
        setActiveFileName("main.js");
      }
    }
  };

  const handleRenderLoop = async (
    onRenderComplete: (wavBuffer: ArrayBuffer) => void,
  ) => {
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
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith("./")) {
              return {
                path: args.path.replace("./", ""),
                namespace: "virtual",
              };
            }
            if (projectFiles.find((f) => f.fileName === args.path)) {
              return { path: args.path, namespace: "virtual" };
            }
            return null;
          });
          build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
            const file = projectFiles.find((f) => f.fileName === args.path);
            if (file) {
              return { contents: file.fileContent, loader: "js" };
            }
            return null;
          });
        },
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

      const decodedSamples: Record<string, Float32Array> = {};
      if (projectSamples.length > 0) {
        const audioCtx = new window.AudioContext({ sampleRate });
        try {
          await Promise.all(projectSamples.map(async (sample) => {
            try {
              const bufferCopy = sample.sampleData.slice(0);
              const audioBuffer = await audioCtx.decodeAudioData(bufferCopy);
              decodedSamples[sample.sampleName] = audioBuffer.getChannelData(0);
            } catch (err) {
              console.error(
                `Failed to decode sample ${sample.sampleName}`,
                err,
              );
            }
          }));
        } finally {
          audioCtx.close();
        }
      }

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
        samples: decodedSamples,
      });
    } catch (bundleError) {
      setIsBundling(false);
      setErrorMessage(
        `Bundle Error: ${
          bundleError instanceof Error
            ? bundleError.message
            : String(bundleError)
        }`,
      );
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
      activeSampleName,
    };
    archiveData["project.json"] = strToU8(JSON.stringify(metadata));
    for (const file of projectFiles) {
      archiveData[`code/${file.fileName}`] = strToU8(file.fileContent);
    }
    for (const sample of projectSamples) {
      archiveData[`samples/${sample.sampleName}`] = new Uint8Array(
        sample.sampleData,
      );
    }
    const zipped = zipSync(archiveData);
    const blob = new Blob([zipped as Uint8Array<ArrayBuffer>], {
      type: "application/zip",
    });
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
          const newSamples: ProjectSample[] = [];
          for (const [fileName, fileBytes] of Object.entries(unzipped)) {
            if (fileName === "project.json") continue;
            if (fileName.startsWith("samples/")) {
              newSamples.push({
                sampleName: fileName.replace("samples/", ""),
                sampleData: fileBytes.slice(0).buffer,
              });
            } else {
              const name = fileName.startsWith("code/")
                ? fileName.replace("code/", "")
                : fileName;
              newFiles.push({
                fileName: name,
                fileContent: strFromU8(fileBytes),
              });
            }
          }
          setLoopLengthSeconds(metadata.loopLengthSeconds);
          setSampleRate(metadata.sampleRate);
          setProjectFiles(newFiles);
          setProjectSamples(newSamples);
          setActiveFileName(
            metadata.activeFileName ||
              (newFiles.length > 0 ? newFiles[0].fileName : null),
          );
          setActiveSampleName(metadata.activeSampleName || null);
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

  const handleKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const textarea = event.currentTarget;
      const { selectionStart, selectionEnd, value } = textarea;
      const newValue = value.substring(0, selectionStart) + "  " +
        value.substring(selectionEnd);

      setProjectFiles((prev) =>
        prev.map((file) =>
          file.fileName === activeFileName
            ? { ...file, fileContent: newValue }
            : file
        )
      );

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
          <div className={styles.headerLabel}>Length (s)</div>
          <input
            id="lengthInput"
            type="number"
            className={styles.headerInput}
            value={loopLengthSeconds}
            onInput={(event) =>
              setLoopLengthSeconds(
                Number((event.target as HTMLInputElement).value),
              )}
            min={0.1}
            step={0.1}
            style={{ width: "60px" }}
          />
        </div>
        <div className={styles.externalDropdown} ref={sampleRateDropdownRef}>
          <div
            className={styles.headerControl}
            onClick={() => setShowSampleRateDropdown(!showSampleRateDropdown)}
            style={{ cursor: "pointer" }}
          >
            <div className={styles.headerLabel}>Sample Rate</div>
            <div className={styles.headerInput}>
              {sampleRate / 1000} kHz ▾
            </div>
          </div>
          {showSampleRateDropdown && (
            <div className={styles.dropdownMenu}>
              {[44100, 96000, 192000].map((rate) => (
                <button
                  key={rate}
                  className={`${styles.dropdownItem} ${
                    sampleRate === rate ? styles.dropdownItemActive : ""
                  }`}
                  onClick={() => {
                    setSampleRate(rate);
                    setShowSampleRateDropdown(false);
                  }}
                >
                  {rate / 1000} kHz
                </button>
              ))}
            </div>
          )}
        </div>
        {errorMessage && (
          <div
            style={{
              color: "#ff8888",
              fontSize: "12px",
              maxWidth: "300px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {errorMessage}
          </div>
        )}
        <div className={styles.playbackControls}>
          <button
            className={styles.playbackButton}
            onClick={handlePlayLoop}
            disabled={isBundling || isRendering}
          >
            {isBundling ? "Bundling..." : isRendering ? "Rendering..." : "Loop"}
          </button>
          <button className={styles.playbackButton} onClick={handleStopLoop}>
            Stop
          </button>

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
                  onClick={() => {
                    handleDownloadLoop();
                    setShowDropdown(false);
                  }}
                  disabled={isBundling || isRendering}
                >
                  Download WAV
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    handleArchiveProject();
                    setShowDropdown(false);
                  }}
                >
                  Download Archive
                </button>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowDropdown(false);
                  }}
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
          <div className={styles.explorerSection}>
            <div className={styles.explorerHeader}>
              Code
              <button className={styles.addFileButton} onClick={handleAddFile}>
                +
              </button>
            </div>
            <div className={styles.fileList}>
              {projectFiles.map((file) => (
                <div
                  key={file.fileName}
                  className={`${styles.fileItem} ${
                    activeFileName === file.fileName
                      ? styles.fileItemActive
                      : ""
                  }`}
                  onClick={() => {
                    if (editingFileName === file.fileName) return;
                    setActiveFileName(file.fileName);
                    setActiveSampleName(null);
                  }}
                  onDblClick={() => handleStartRename(file.fileName)}
                >
                  {editingFileName === file.fileName
                    ? (
                      <input
                        ref={fileNameInputRef}
                        className={styles.fileNameInput}
                        value={tempFileName}
                        onInput={(e) =>
                          setTempFileName((e.target as HTMLInputElement).value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishRename();
                          if (e.key === "Escape") setEditingFileName(null);
                        }}
                        onBlur={handleFinishRename}
                      />
                    )
                    : <span>{file.fileName}</span>}
                  {file.fileName !== "main.js" && !editingFileName && (
                    <button
                      className={styles.deleteFileButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFile(file.fileName);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className={styles.explorerSection}>
            <div className={styles.explorerHeader}>
              Samples
              <button
                className={styles.addFileButton}
                onClick={() => sampleInputRef.current?.click()}
              >
                +
              </button>
              <input
                type="file"
                ref={sampleInputRef}
                style={{ display: "none" }}
                accept=".wav"
                onChange={handleAddSample}
              />
            </div>
            <div className={styles.fileList}>
              {projectSamples.map((sample) => (
                <div
                  key={sample.sampleName}
                  className={`${styles.fileItem} ${
                    activeSampleName === sample.sampleName
                      ? styles.fileItemActive
                      : ""
                  }`}
                  onClick={() => {
                    if (editingSampleName === sample.sampleName) return;
                    setActiveSampleName(sample.sampleName);
                    setActiveFileName(null);
                  }}
                  onDblClick={() => handleStartRenameSample(sample.sampleName)}
                >
                  {editingSampleName === sample.sampleName
                    ? (
                      <input
                        ref={fileNameInputRef}
                        className={styles.fileNameInput}
                        value={tempFileName}
                        onInput={(e) =>
                          setTempFileName((e.target as HTMLInputElement).value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleFinishRenameSample();
                          if (e.key === "Escape") setEditingSampleName(null);
                        }}
                        onBlur={handleFinishRenameSample}
                      />
                    )
                    : (
                      <>
                        <span>{sample.sampleName}</span>
                        <div className={styles.itemActions}>
                          <button
                            className={styles.actionButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicateSample(sample.sampleName);
                            }}
                            title="Duplicate"
                          >
                            ⧉
                          </button>
                          <button
                            className={styles.deleteFileButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSample(sample.sampleName);
                            }}
                            title="Delete"
                          >
                            ×
                          </button>
                        </div>
                      </>
                    )}
                </div>
              ))}
            </div>
          </div>
        </aside>
        <div className={styles.editorContainer}>
          {activeSampleName && activeSample
            ? (
              <WaveformEditor
                sampleName={activeSample.sampleName}
                sampleData={activeSample.sampleData}
                onCrop={(newBuffer) =>
                  handleCropSample(activeSample.sampleName, newBuffer)}
              />
            )
            : (
              <textarea
                className={styles.scriptEditor}
                value={activeFile?.fileContent || ""}
                onInput={(event) =>
                  handleUpdateFileContent(
                    (event.target as HTMLTextAreaElement).value,
                  )}
                onKeyDown={handleKeyDown}
                spellcheck={false}
              />
            )}
        </div>
      </main>
    </div>
  );
}
