import { Link } from "react-router-dom";
import BackButton from "../components/BackButton";
import { GAMES, LIVE_GAMES } from "../platform/registry";

/** Fun ideas waiting for a "yes" (docs/ROADMAP.md). */
const IDEAS: { icon: string; title: string; text: string }[] = [
  { icon: "🏟️", title: "Live Arcade Lobby", text: "Other players' characters walk around the Hub. Wave at them." },
  { icon: "🐉", title: "Community Boss Raid", text: "Every game anyone plays damages one giant weekly boss. Everyone who helped gets loot." },
  { icon: "👻", title: "Ghost races", text: "Play against the replay ghost of the #1 player." },
  { icon: "🐣", title: "Pet that grows", text: "Your pet levels up as you play and follows you around." },
  { icon: "⚡", title: "Glitch Hour", text: "A random hour each day with weird twists and double coins." },
  { icon: "🗓️", title: "Free seasons", text: "A 30-day season with a free reward track, season themes and titles." },
  { icon: "🛡️", title: "Crews", text: "Teams of up to 10 with a weekly crew leaderboard." },
  { icon: "📸", title: "Share cards", text: "A pretty picture of your score and character to share." },
  { icon: "🎹", title: "Chiptune Jukebox", text: "Make your own 8-bar song and set it as your profile song." },
  { icon: "🏆", title: "Weekend tournaments", text: "An automatic online bracket every weekend, with a trophy title." },
];

export default function Roadmap() {
  const soon = GAMES.filter((g) => g.meta.status !== "live");
  return (
    <div className="roadmap-page">
      <div className="page-head">
        <div>
          <BackButton />
          <h1 style={{ marginTop: 12 }}>🗺️ Roadmap</h1>
          <p>What's live, what's coming next, and ideas on the table. Every game follows the same Game Kit, so they all feel like one arcade.</p>
        </div>
      </div>

      <section>
        <h2 className="section-title">✅ Live now · {LIVE_GAMES.length}</h2>
        <ul className="roadmap-list">
          {LIVE_GAMES.map((g) => (
            <li key={g.meta.id} className={`roadmap-item accent-${g.meta.accent}`}>
              <span className="roadmap-icon" aria-hidden="true">
                {g.meta.icon}
              </span>
              <span>
                <strong>{g.meta.title}</strong>
                <small>{g.meta.tagline}</small>
              </span>
              <Link to={`/play/${g.meta.id}`} className="btn btn-sm">
                ▶ Play
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-title">🛠️ Coming next · {soon.length}</h2>
        <ul className="roadmap-list">
          {soon.map((g) => (
            <li key={g.meta.id} className={`roadmap-item accent-${g.meta.accent}`}>
              <span className="roadmap-icon" aria-hidden="true">
                {g.meta.icon}
              </span>
              <span>
                <strong>{g.meta.title}</strong>
                <small>{g.meta.tagline}</small>
              </span>
              <span className="tag tag-yellow">Planned</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-title">💡 Ideas</h2>
        <ul className="roadmap-ideas">
          {IDEAS.map((i) => (
            <li key={i.title} className="panel">
              <span aria-hidden="true">{i.icon}</span>
              <strong>{i.title}</strong>
              <small>{i.text}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
