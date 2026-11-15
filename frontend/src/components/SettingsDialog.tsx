import { useEffect, useMemo, useRef, useState } from "react";
import { useSync } from "../platform/settingsSync";
import { useAuth } from "../store/auth";
import { useSettings } from "../store/settings";
import AccountPanel from "./settings/AccountPanel";
import ControlsPanel from "./settings/ControlsPanel";
import LivePreview from "./settings/LivePreview";
import PrivacyPanel from "./settings/PrivacyPanel";
import { ROWS, SECTION_KEYS, SECTIONS, searchRows, sectionDefaults, type Row, type SectionId } from "./settings/rows";

/** The section you looked at last (until the page reloads). */
let lastSection: SectionId = "appearance";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** One setting: name and explanation on the left, its control on the right. */
function SettingRow({ row, onOpen }: { row: Row; onOpen?: (s: SectionId) => void }) {
  const C = row.Control;
  const text = (
    <span className="set-row-text">
      <strong>{row.label}</strong>
      {row.hint && <small>{row.hint}</small>}
    </span>
  );
  if (!C) {
    const sec = SECTIONS.find((s) => s.id === row.section);
    return (
      <button type="button" className="set-row set-row-link" onClick={() => onOpen?.(row.section)}>
        {text}
        <span className="set-row-go">
          {sec?.label} ›
        </span>
      </button>
    );
  }
  return (
    <div className={`set-row${row.stack ? " stack" : ""}`} data-row={row.id}>
      {text}
      <div className="set-row-control">
        <C />
      </div>
    </div>
  );
}

/** Rows grouped under their small headings, in order. */
function Groups({ rows, onOpen }: { rows: Row[]; onOpen?: (s: SectionId) => void }) {
  const groups: { name: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const g = groups.find((x) => x.name === r.group);
    if (g) g.rows.push(r);
    else groups.push({ name: r.group, rows: [r] });
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.name} className="set-group" aria-label={g.name}>
          <h3>{g.name}</h3>
          <div className="set-group-rows">
            {g.rows.map((r) => (
              <SettingRow key={r.id} row={r} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * Settings: a full-screen page over whatever you were doing (a game keeps
 * running underneath). A list of sections on the left, clean rows on the
 * right, a search box, and a reset for each section. On phones the list
 * comes first and you tap into a section.
 */
export default function SettingsDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const update = useSettings((s) => s.update);
  const user = useAuth((a) => a.user);
  const sync = useSync((x) => x.status);
  const [section, setSectionState] = useState<SectionId>(lastSection);
  const [query, setQuery] = useState("");
  /** Phones: showing a section (true) or the list of sections (false). */
  const [inSection, setInSection] = useState(false);
  const [resetDone, setResetDone] = useState<SectionId | null>(null);

  const openSection = (id: SectionId) => {
    lastSection = id;
    setSectionState(id);
    setQuery("");
    setInSection(true);
    setResetDone(null);
    document.querySelector(".set-content")?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQuery("");
      setInSection(false);
      setResetDone(null);
    }
    if (!open && d.open) d.close();
  }, [open]);

  // "/" jumps to the search box, like many apps.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const results = useMemo(() => searchRows(query, ROWS), [query]);
  const searching = query.trim().length > 0;
  const current = SECTIONS.find((s) => s.id === section)!;
  const rows = ROWS.filter((r) => r.section === section && r.Control && (!r.available || r.available()));
  const canReset = !!SECTION_KEYS[section];

  const syncText =
    user && !user.is_guest
      ? { off: "", loading: "Loading your settings…", synced: "Saved to your account", saving: "Saving…", error: "Couldn't sync; saved in this browser" }[sync]
      : "Saved in this browser";

  return (
    <dialog ref={ref} className={`settings-screen${inSection || searching ? " in-section" : ""}`} aria-labelledby="settings-title" onClose={onClose}>
      <header className="set-header">
        <h2 id="settings-title">⚙️ Settings</h2>
        <span className="set-sync" role="status">
          {syncText}
        </span>
        <button type="button" className="set-close" onClick={onClose} aria-label="Close settings">
          ✕ <span>Close</span>
        </button>
      </header>

      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          <label className="set-search">
            <span aria-hidden="true">🔍</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search settings"
              aria-label="Search settings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="set-nav-item"
                  aria-current={!searching && section === s.id ? "page" : undefined}
                  onClick={() => openSection(s.id)}
                >
                  <span className="set-nav-icon" aria-hidden="true">
                    {s.icon}
                  </span>
                  <span>
                    <strong>{s.label}</strong>
                    <small>{s.blurb}</small>
                  </span>
                  <span className="set-nav-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="set-content">
          <div className="set-content-inner">
            {searching ? (
              <>
                <div className="set-title">
                  <button type="button" className="set-back" onClick={() => setQuery("")}>
                    ‹ All settings
                  </button>
                  <h2>Results for "{query.trim()}"</h2>
                </div>
                {results.length ? (
                  SECTIONS.filter((s) => results.some((r) => r.section === s.id)).map((s) => (
                    <section key={s.id} className="set-group" aria-label={s.label}>
                      <h3>
                        {s.icon} {s.label}
                      </h3>
                      <div className="set-group-rows">
                        {results
                          .filter((r) => r.section === s.id)
                          .map((r) => (
                            <SettingRow key={r.id} row={r} onOpen={openSection} />
                          ))}
                      </div>
                    </section>
                  ))
                ) : (
                  <p className="set-empty">Nothing matches. Try "volume", "dark", "keys" or "password".</p>
                )}
              </>
            ) : (
              <>
                <div className="set-title">
                  <button type="button" className="set-back" onClick={() => setInSection(false)}>
                    ‹ All settings
                  </button>
                  <h2>
                    <span aria-hidden="true">{current.icon}</span> {current.label}
                  </h2>
                  <p>{current.blurb}</p>
                  {canReset && (
                    <button
                      type="button"
                      className="set-reset"
                      onClick={() => {
                        update(sectionDefaults(section));
                        setResetDone(section);
                      }}
                    >
                      {resetDone === section ? "✓ Reset" : "Reset this section"}
                    </button>
                  )}
                </div>
                {section === "appearance" && <LivePreview />}
                {rows.length > 0 && <Groups rows={rows} />}
                {section === "controls" && <ControlsPanel />}
                {section === "privacy" && <PrivacyPanel onClose={onClose} />}
                {section === "account" && <AccountPanel onClose={onClose} />}
              </>
            )}
          </div>
        </main>
      </div>
    </dialog>
  );
}
