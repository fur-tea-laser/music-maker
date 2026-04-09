import { useState } from "preact/hooks";
import { MusicPart, renderMusicLoop } from "../audio/renderMusicLoop.ts";
import { playLoop, stopLoop } from "../audio/audioEngine.ts";
import styles from "../styles/App.module.scss";
const initialMusicParts: Record<number, MusicPart> = {
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
  const [currentLoopParts, setLoopParts] = useState<Record<number, MusicPart>>(initialMusicParts);
  const [loopLengthSeconds, setLoopLengthSeconds] = useState<number>(2);
  const [loopSampleRate, setLoopSampleRate] = useState<number>(44100);
  const handlePartChange = (partId: number, fieldName: keyof MusicPart, fieldValue: string | number) => {
    setLoopParts((previousParts) => ({
      ...previousParts,
      [partId]: {
        ...previousParts[partId],
        [fieldName]: fieldValue,
      },
    }));
  };
  const handlePlayClick = () => {
    const loopSampleCount = Math.floor(loopSampleRate * loopLengthSeconds);
    const loopWav = renderMusicLoop({
      loopSampleCount,
      loopSampleRate,
      loopParts: currentLoopParts,
    });
    playLoop({ apiData: loopWav.buffer });
  };
  const handleStopClick = () => {
    stopLoop();
  };
  return (
    <div class={styles.container}>
      <h1 class={styles.headerTitle}>Music Loop Editor</h1>
      <div class={styles.settingsSection}>
        <div class={styles.settingItem}>
          <label class={styles.settingLabel}>Loop Length (seconds)</label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={loopLengthSeconds}
            onChange={(event) => setLoopLengthSeconds(parseFloat((event.target as HTMLInputElement).value))}
            class={styles.settingInput}
          />
        </div>
        <div class={styles.settingItem}>
          <label class={styles.settingLabel}>Sample Rate (Hz)</label>
          <select
            value={loopSampleRate}
            onChange={(event) => setLoopSampleRate(parseInt((event.target as HTMLSelectElement).value))}
            class={styles.settingSelect}
          >
            <option value={44100}>44100</option>
            <option value={96000}>96000</option>
            <option value={192000}>192000</option>
          </select>
        </div>
      </div>
      <div class={styles.partsList}>
        {Object.values(currentLoopParts).map((someLoopPart) => (
          <div key={someLoopPart.partId} class={styles.partItem}>
            <div class={styles.partHeader}>
              <span class={styles.partIdLabel}>Part {someLoopPart.partId}</span>
              <div class={styles.rangeInputs}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={someLoopPart.partStart}
                  onChange={(event) => handlePartChange(someLoopPart.partId, "partStart", parseFloat((event.target as HTMLInputElement).value))}
                  class={styles.rangeInput}
                />
                <span class={styles.rangeSeparator}>to</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={someLoopPart.partEnd}
                  onChange={(event) => handlePartChange(someLoopPart.partId, "partEnd", parseFloat((event.target as HTMLInputElement).value))}
                  class={styles.rangeInput}
                />
              </div>
            </div>
            <textarea
              value={someLoopPart.partSampleSource}
              onInput={(event) => handlePartChange(someLoopPart.partId, "partSampleSource", (event.target as HTMLTextAreaElement).value)}
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
        <button class={styles.stopButton} onClick={handleStopClick}>
          Stop Loop
        </button>
      </div>
    </div>
  );
};
