import { useCallback, useEffect, useRef, useState } from "react";
import { rooms } from "../api/client";
import type { RoomView } from "../api/types";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * Keep a room up to date: join it (rejoining your own seat is fine), then
 * keep asking the server for anything newer than what we have. The server
 * holds each request up to 20 s, so news arrives within about a second.
 */
export function useRoom(code: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const version = useRef<number | undefined>(undefined);

  const apply = useCallback((r: RoomView) => {
    if (version.current !== undefined && r.version < version.current) return;
    version.current = r.version;
    setRoom(r);
  }, []);

  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    version.current = undefined;
    (async () => {
      try {
        apply(await rooms.join(code));
      } catch (e) {
        if (!alive) return;
        setError(errMsg(e, "could not join this room"));
        setFatal(true);
        return;
      }
      while (alive) {
        try {
          const r = await rooms.get(code, version.current, ctrl.signal);
          if (!alive) break;
          apply(r);
          setError(null);
        } catch (e) {
          if (!alive) break;
          setError(`Connection problem (${errMsg(e, "network")}). Retrying…`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [code, apply]);

  /** Run an action (move, emote, ...) and show its result right away. */
  const act = useCallback(
    async (fn: () => Promise<RoomView>) => {
      try {
        apply(await fn());
        return true;
      } catch (e) {
        setError(errMsg(e, "that didn't work"));
        return false;
      }
    },
    [apply],
  );

  return { room, error, fatal, act };
}
