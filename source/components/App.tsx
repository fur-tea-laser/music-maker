import { useState, useRef } from "preact/hooks";
import { MusicPart, renderMusicLoop } from "../audio/renderMusicLoop.ts";
import styles from "../styles/App.module.scss";

interface MusicPartsState {
  [key: number]: MusicPart;
}

const initialMusicParts: MusicPartsState = {
  1: {
    partId: 1,
    partStart: 0,
    partEnd: 0.5,
    partSampleSource: "(t, rt) => Math.sin(t * 2 * Math.PI * 440) * 0.1",
  },
  2: {
    partId: 2,
    partStart: 0.5,
    partEnd: 1,
    partSampleSource: "(t, rt) => Math.sin(t * 2 * Math.PI * 880) * 0.1",
  },
};

export const App = () => {
  const [musicParts, setMusicParts] = useState<MusicPartsState>(initialMusicParts);
  const audioRef = useRef<HTMLAudioElement>(null);
  const handlePartChange = (partId: number, fieldName: keyof MusicPart, fieldValue: string | number) => {
    setMusicParts((previousParts) => ({
      ...previousParts,
      [partId]: {
        ...previousParts[partId],
        [fieldName]: fieldValue,
      },
    }));
  };
  const handlePlayClick = () => {
    const loopSampleRate = 44100;
    const loopSampleCount = loopSampleRate * 2;
    const resultWav = renderMusicLoop({
      loopParts: musicParts,
      loopSampleCount,
      loopSampleRate,
    });
    const audioBlob = new Blob([resultWav], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(audioBlob);
    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play();
    }
  };
  return (
    <div class={styles.container}>
      <h1 class={styles.headerTitle}>Music Loop Editor</h1>
      <div class={styles.partsList}>
        {Object.values(musicParts).map((musicPart) => (
          <div key={musicPart.partId} class={styles.partItem}>
            <div class={styles.partHeader}>
              <span class={styles.partIdLabel}>Part {musicPart.partId}</span>
              <div class={styles.rangeInputs}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={musicPart.partStart}
                  onChange={(event) => handlePartChange(musicPart.partId, "partStart", parseFloat((event.target as HTMLInputElement).value))}
                  class={styles.rangeInput}
                />
                <span class={styles.rangeSeparator}>to</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={musicPart.partEnd}
                  onChange={(event) => handlePartChange(musicPart.partId, "partEnd", parseFloat((event.target as HTMLInputElement).value))}
                  class={styles.rangeInput}
                />
              </div>
            </div>
            <textarea
              value={musicPart.partSampleSource}
              onInput={(event) => handlePartChange(musicPart.partId, "partSampleSource", (event.target as HTMLTextAreaElement).value)}
              class={styles.sourceEditor}
              rows={2}
            />
          </div>
        ))}
      </div>
      <div class={styles.controlsSection}>
        <button class={styles.playButton} onClick={handlePlayClick}>
          Render & Play Loop
        </button>
      </div>
      <audio ref={audioRef} />
    </div>
  );
};
