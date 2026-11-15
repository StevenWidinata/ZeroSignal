import { THEMES } from "../../platform/themes";
import { useSettings } from "../../store/settings";
import { useTheme } from "../../store/theme";

/** A small sample of the arcade that follows theme, text size, contrast and font as you change them. */
export default function LivePreview() {
  const theme = useTheme((t) => t.theme);
  const s = useSettings();
  const name = THEMES.find((t) => t.id === theme)?.name ?? theme;
  const tags = [name, s.textSize.toUpperCase() + " text", s.highContrast && "High contrast", s.readableFont && "Readable font", s.colorblind && "Colorblind"].filter(
    Boolean,
  ) as string[];
  return (
    <div className="set-preview" aria-label="Preview of your choices">
      <div className="set-preview-card">
        <p className="set-preview-title">ZERO SIGNAL</p>
        <p className="set-preview-text">This is how text, buttons and game pieces look with your choices.</p>
        <div className="set-preview-row">
          <span className="btn btn-green btn-sm" aria-hidden="true">
            ▶ Play
          </span>
          <span className="btn btn-ghost btn-sm" aria-hidden="true">
            Scores
          </span>
          <span className="set-preview-tiles" aria-hidden="true">
            <i style={{ background: "var(--yellow)" }}>2</i>
            <i style={{ background: "var(--green)" }}>4</i>
            <i style={{ background: "var(--blue)" }}>8</i>
          </span>
        </div>
      </div>
      <ul className="set-preview-tags">
        {tags.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
