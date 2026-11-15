import { useState, type ComponentType } from "react";
import { canFullscreen, toggleFullscreen, useFullscreen } from "../../platform/display";
import { resetSeen } from "../../platform/tutorial";
import { TEXT_SIZES, TIMER_OPTIONS, useSettings, type Settings, type TextSize } from "../../store/settings";
import { useTheme } from "../../store/theme";
import { ROW_INFO, type RowInfo } from "./sections";
import ThemePicker from "./ThemePicker";

export { SECTIONS, SECTION_KEYS, searchRows, sectionDefaults, type SectionId } from "./sections";

/**
 * Every setting's control. The text for each row (and the search) is in
 * sections.ts; rows without a control are links to their section.
 */

export interface Row extends RowInfo {
  Control?: ComponentType;
}

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

function Toggle({ k, disabled }: { k: keyof Settings; disabled?: (s: Settings) => boolean }) {
  const s = useSettings();
  return (
    <input
      type="checkbox"
      className="switch"
      checked={s[k] as boolean}
      disabled={disabled?.(s)}
      onChange={(e) => s.update({ [k]: e.target.checked } as Partial<Settings>)}
    />
  );
}
const toggle = (k: keyof Settings, disabled?: (s: Settings) => boolean): ComponentType =>
  function ToggleRow() {
    return <Toggle k={k} disabled={disabled} />;
  };

function Volume({ k, off }: { k: "volume" | "uiVolume" | "musicVolume"; off: (s: Settings) => boolean }) {
  const s = useSettings();
  const v = Math.round(s[k] * 100);
  return (
    <span className="set-range">
      <input type="range" min={0} max={100} step={5} value={v} disabled={off(s)} onChange={(e) => s.update({ [k]: Number(e.target.value) / 100 })} />
      <output>{v}%</output>
    </span>
  );
}
const volume = (k: "volume" | "uiVolume" | "musicVolume", off: (s: Settings) => boolean): ComponentType =>
  function VolumeRow() {
    return <Volume k={k} off={off} />;
  };

/** A row of choices (Off / 10s / 20s / 30s). */
export function Segmented<T extends string | number>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; aria?: string }[];
  label: string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="set-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} aria-label={o.aria} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TEXT_SIZE_NAME: Record<TextSize, string> = { s: "Small", m: "Medium", l: "Large", xl: "Extra large" };

function TextSizeControl() {
  const s = useSettings();
  return (
    <Segmented
      label="Text size"
      value={s.textSize}
      options={TEXT_SIZES.map((t) => ({ value: t, label: t.toUpperCase(), aria: TEXT_SIZE_NAME[t] }))}
      onChange={(t) => s.update({ textSize: t })}
    />
  );
}

function TimerControl() {
  const s = useSettings();
  return (
    <Segmented
      label="Turn timer"
      value={s.turnTimer}
      options={TIMER_OPTIONS.map((t) => ({ value: t, label: t === 0 ? "Off" : `${t}s` }))}
      onChange={(t) => s.update({ turnTimer: t })}
    />
  );
}

function DarkControl() {
  const scheme = useTheme((t) => t.scheme);
  const toggleTheme = useTheme((t) => t.toggle);
  return <input type="checkbox" className="switch" checked={scheme === "dark"} onChange={toggleTheme} aria-label="Dark version" />;
}

function FullscreenControl() {
  const on = useFullscreen();
  return <input type="checkbox" className="switch" checked={on} onChange={() => void toggleFullscreen()} aria-label="Fullscreen" />;
}

function TutorialsControl() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="set-btn"
      disabled={done}
      onClick={() => {
        resetSeen();
        setDone(true);
      }}
    >
      {done ? "✓ Done" : "Show again"}
    </button>
  );
}

const soundOff = (s: Settings) => !s.sound;

// ---------------------------------------------------------------------------
// Rows = the text from sections.ts + these controls
// ---------------------------------------------------------------------------

const CONTROLS: Record<string, ComponentType> = {
  theme: ThemePicker,
  dark: DarkControl,
  textSize: TextSizeControl,
  readableFont: toggle("readableFont"),
  highContrast: toggle("highContrast"),
  colorblind: toggle("colorblind"),
  reducedMotion: toggle("reducedMotion"),
  lightGraphics: toggle("lightGraphics"),
  screenShake: toggle("screenShake"),
  showFps: toggle("showFps"),
  fullscreen: FullscreenControl,
  sound: toggle("sound"),
  volume: volume("volume", soundOff),
  uiVolume: volume("uiVolume", soundOff),
  music: toggle("music"),
  musicVolume: volume("musicVolume", (s) => !s.music),
  turnTimer: TimerControl,
  confirmLeave: toggle("confirmLeave"),
  vibration: toggle("vibration"),
  tutorials: TutorialsControl,
  dailyLoginPopup: toggle("dailyLoginPopup"),
  levelUpPopup: toggle("levelUpPopup"),
  rewardToasts: toggle("rewardToasts"),
};

/** Settings that only exist on some devices. */
const AVAILABLE: Record<string, () => boolean> = { fullscreen: canFullscreen };

export const ROWS: Row[] = ROW_INFO.map((r) => ({ ...r, Control: CONTROLS[r.id], available: AVAILABLE[r.id] }));
