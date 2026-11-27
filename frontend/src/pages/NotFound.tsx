import { Link, useLocation } from "react-router-dom";
import BackButton from "../components/BackButton";
import { PingFigure } from "../mascot/PingNote";

/** Any address the site doesn't know: Ping, upside down and a bit lost. */
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="not-found-page">
      <BackButton />
      <section className="panel not-found">
        <PingFigure pose="hang" scale={3} />
        <div className="not-found-text">
          <h1>Lost signal</h1>
          <p>
            There's nothing at <code>{pathname}</code>. Ping checked twice, upside down and the right way up.
          </p>
          <div className="hero-actions">
            <Link to="/" className="btn btn-green">
              ▶ Back to games
            </Link>
            <Link to="/leaderboard" className="btn btn-ghost">
              Leaderboards
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
