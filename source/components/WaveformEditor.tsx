import { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import styles from "../styles/WaveformEditor.module.scss";

interface WaveformEditorProps {
  sampleName: string;
  sampleData: ArrayBuffer;
  onCrop: (newBuffer: ArrayBuffer) => void;
}

function encodeWav16(
  audioBuffer: AudioBuffer,
  startRatio: number,
  endRatio: number,
): ArrayBuffer {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = audioBuffer.length;

  const startIndex = Math.floor(startRatio * totalSamples);
  const endIndex = Math.floor(endRatio * totalSamples);
  const sampleCount = Math.max(0, endIndex - startIndex);

  const headerSize = 44;
  const dataSize = sampleCount * numChannels * 2;
  const wavFile = new Uint8Array(headerSize + dataSize);
  const view = new DataView(wavFile.buffer);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // ChunkSize
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
  view.setUint16(32, numChannels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true); // dataSize

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      let sample = audioBuffer.getChannelData(channel)[startIndex + i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7FFF,
        true,
      );
      offset += 2;
    }
  }

  return wavFile.buffer;
}

export function WaveformEditor(
  { sampleName, sampleData, onCrop }: WaveformEditorProps,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panRatio, setPanRatio] = useState(0);
  const [markerStart, setMarkerStart] = useState(0);
  const [markerEnd, setMarkerEnd] = useState(1);
  const [playbackCursorRatio, setPlaybackCursorRatio] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<"start" | "end" | "pan" | null>(
    null,
  );
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartValue, setDragStartValue] = useState(0);

  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [sourceNode, setSourceNode] = useState<AudioBufferSourceNode | null>(
    null,
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const playStartTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const ctx = new window.AudioContext();
    setAudioContext(ctx);
    return () => {
      ctx.close();
    };
  }, []);

  useEffect(() => {
    if (!audioContext || !sampleData) return;
    let isActive = true;

    // Copy buffer because decodeAudioData detaches it in some browsers
    const bufferCopy = sampleData.slice(0);
    audioContext.decodeAudioData(bufferCopy)
      .then((buffer) => {
        if (isActive) {
          setAudioBuffer(buffer);
          setMarkerStart(0);
          setMarkerEnd(1);
          setZoomLevel(1);
          setPanRatio(0);
        }
      })
      .catch((e) => console.error("Failed to decode audio", e));

    return () => {
      isActive = false;
    };
  }, [audioContext, sampleData, sampleName]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas for sharp rendering
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Draw zero line
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    const data = audioBuffer.getChannelData(0);
    const sampleCount = data.length;

    const visibleSamples = Math.max(1, Math.floor(sampleCount / zoomLevel));
    const startSample = Math.max(0, Math.floor(panRatio * sampleCount));
    const endSample = Math.min(sampleCount, startSample + visibleSamples);

    const step = Math.ceil((endSample - startSample) / width);

    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    for (let i = 0; i < width; i++) {
      const dataIndex = startSample + i * step;
      if (dataIndex >= sampleCount) break;

      let min = 0;
      let max = 0;
      for (let j = 0; j < step && dataIndex + j < sampleCount; j++) {
        const val = data[dataIndex + j];
        if (val < min) min = val;
        if (val > max) max = val;
      }

      ctx.lineTo(i, (1 + min) * height / 2);
      ctx.lineTo(i, (1 + max) * height / 2);
    }
    ctx.strokeStyle = "#007acc";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw markers
    const startX =
      ((markerStart * sampleCount - startSample) / visibleSamples) * width;
    const endX = ((markerEnd * sampleCount - startSample) / visibleSamples) *
      width;

    if (
      startX >= 0 && startX <= width || endX >= 0 && endX <= width ||
      (startX < 0 && endX > width)
    ) {
      ctx.fillStyle = "rgba(0, 200, 0, 0.2)";
      const drawStartX = Math.max(0, startX);
      const drawEndX = Math.min(width, endX);
      ctx.fillRect(drawStartX, 0, drawEndX - drawStartX, height);
    }

    if (startX >= -2 && startX <= width + 2) {
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(startX - 1, 0, 3, height);
    }
    if (endX >= -2 && endX <= width + 2) {
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(endX - 1, 0, 3, height);
    }

    // Draw playback cursor
    if (playbackCursorRatio !== null) {
      const cursorX = ((playbackCursorRatio * sampleCount - startSample) / visibleSamples) * width;
      if (cursorX >= 0 && cursorX <= width) {
        ctx.fillStyle = "#ffff00";
        ctx.fillRect(cursorX - 1, 0, 2, height);
      }
    }
  };

  useEffect(() => {
    drawCanvas();
    window.addEventListener("resize", drawCanvas);
    return () => window.removeEventListener("resize", drawCanvas);
  }, [audioBuffer, zoomLevel, panRatio, markerStart, markerEnd, playbackCursorRatio]);

  const updatePlaybackCursor = () => {
    if (!audioContext || !audioBuffer || !isPlaying) return;
    const duration = audioBuffer.duration;
    const markerDuration = (markerEnd - markerStart) * duration;
    const elapsed = audioContext.currentTime - playStartTimeRef.current;
    const currentOffset = markerStart * duration + (elapsed % markerDuration);
    setPlaybackCursorRatio(currentOffset / duration);
    rafRef.current = requestAnimationFrame(updatePlaybackCursor);
  };

  useEffect(() => {
    if (isPlaying) {
      rafRef.current = requestAnimationFrame(updatePlaybackCursor);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setPlaybackCursorRatio(null);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, markerStart, markerEnd]);

  const handlePointerDown = (
    e: JSX.TargetedPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!audioBuffer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const sampleCount = audioBuffer.length;
    const visibleSamples = sampleCount / zoomLevel;
    const startSample = panRatio * sampleCount;

    const clickRatio = (startSample + (x / rect.width) * visibleSamples) /
      sampleCount;

    // Check if clicking near markers
    const threshold = (10 / rect.width) * (visibleSamples / sampleCount);

    if (Math.abs(clickRatio - markerStart) < threshold) {
      setIsDragging("start");
      setDragStartX(x);
      setDragStartValue(markerStart);
    } else if (Math.abs(clickRatio - markerEnd) < threshold) {
      setIsDragging("end");
      setDragStartX(x);
      setDragStartValue(markerEnd);
    } else {
      setIsDragging("pan");
      setDragStartX(x);
      setDragStartValue(panRatio);
    }
  };

  const handlePointerMove = (
    e: JSX.TargetedPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!isDragging || !audioBuffer || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - rect.left - dragStartX;

    const sampleCount = audioBuffer.length;
    const visibleSamples = sampleCount / zoomLevel;
    const ratioDelta = (dx / rect.width) * (visibleSamples / sampleCount);

    if (isDragging === "start") {
      let newValue = dragStartValue + ratioDelta;
      newValue = Math.max(0, Math.min(markerEnd - 0.001, newValue));
      setMarkerStart(newValue);
    } else if (isDragging === "end") {
      let newValue = dragStartValue + ratioDelta;
      newValue = Math.max(markerStart + 0.001, Math.min(1, newValue));
      setMarkerEnd(newValue);
    } else if (isDragging === "pan") {
      let newValue = dragStartValue - ratioDelta;
      const maxPan = 1 - (1 / zoomLevel);
      newValue = Math.max(0, Math.min(maxPan, newValue));
      setPanRatio(newValue);
    }
  };

  const handlePointerUp = () => {
    setIsDragging(null);
  };

  const handleWheel = (e: JSX.TargetedWheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!audioBuffer || !canvasRef.current) return;

    const zoomFactor = e.deltaY < 0 ? 1.4 : 0.7;
    let newZoom = zoomLevel * zoomFactor;
    // Allow zooming in much more, up to 1 sample per pixel roughly
    const maxZoom = audioBuffer.length / 10; 
    newZoom = Math.max(1, Math.min(maxZoom, newZoom));

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratioX = x / rect.width;

    const sampleCount = audioBuffer.length;
    const currentVisible = sampleCount / zoomLevel;
    const currentPanSample = panRatio * sampleCount;
    const mouseSample = currentPanSample + ratioX * currentVisible;

    const newVisible = sampleCount / newZoom;
    const newPanSample = mouseSample - ratioX * newVisible;
    let newPanRatio = newPanSample / sampleCount;

    const maxPan = 1 - (1 / newZoom);
    newPanRatio = Math.max(0, Math.min(maxPan, newPanRatio));

    setZoomLevel(newZoom);
    setPanRatio(newPanRatio);
  };

  const handleCrop = () => {
    if (!audioBuffer) return;
    stopPlayback();
    const newWav = encodeWav16(audioBuffer, markerStart, markerEnd);
    onCrop(newWav);
  };

  const stopPlayback = () => {
    if (sourceNode) {
      sourceNode.stop();
      sourceNode.disconnect();
      setSourceNode(null);
    }
    setIsPlaying(false);
  };

  const handlePlay = (loop: boolean) => {
    if (!audioContext || !audioBuffer) return;
    stopPlayback();

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    const startTimeOffset = markerStart * audioBuffer.duration;
    const endTimeOffset = markerEnd * audioBuffer.duration;

    if (loop) {
      source.loop = true;
      source.loopStart = startTimeOffset;
      source.loopEnd = endTimeOffset;
      source.start(0, startTimeOffset);
    } else {
      source.start(0, startTimeOffset, endTimeOffset - startTimeOffset);
      source.onended = () => setIsPlaying(false);
    }

    source.connect(audioContext.destination);
    setSourceNode(source);
    playStartTimeRef.current = audioContext.currentTime;
    setIsPlaying(true);
  };

  return (
    <div className={styles.editorContainer}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}>Editing: {sampleName}</div>
        <div style={{ flex: 1 }} />
        <button className={styles.toolButton} onClick={() => handlePlay(true)}>
          Loop
        </button>
        <button
          className={styles.toolButton}
          onClick={stopPlayback}
          disabled={!isPlaying}
        >
          Stop
        </button>
        <button
          className={styles.toolButton}
          onClick={handleCrop}
          style={{ marginLeft: "10px" }}
        >
          Crop
        </button>
      </div>
      <div className={styles.canvasContainer}>
        <div className={styles.zoomHint}>
          Scroll to Zoom, Drag to Pan / Move Markers
        </div>
        <canvas
          ref={canvasRef}
          className={styles.waveformCanvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
        />
      </div>
    </div>
  );
}
