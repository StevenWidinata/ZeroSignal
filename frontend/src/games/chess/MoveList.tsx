import { useEffect, useRef } from "react";

/** The moves so far in pairs: "1. e4 e5  2. Nf3 …". */
export default function MoveList({ san, startsBlack = false, startNumber = 1 }: { san: string[]; startsBlack?: boolean; startNumber?: number }) {
  const end = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = end.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [san.length]);
  const moves = startsBlack && san.length ? ["…", ...san] : san;
  const rows: [string, string | undefined][] = [];
  for (let i = 0; i < moves.length; i += 2) rows.push([moves[i], moves[i + 1]]);
  return (
    <ol className="chess-moves" ref={end} start={startNumber} aria-label="Moves">
      {rows.length === 0 && <li className="empty">No moves yet</li>}
      {rows.map(([w, b], i) => (
        <li key={i}>
          <span>{w}</span>
          <span>{b ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}
