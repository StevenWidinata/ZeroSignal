import type { ResultKind } from "./lines";

/**
 * Games tell Ping what happened without importing him: they emit here and the
 * live mascot listens. Nothing happens when he isn't on the page.
 */
export type PingEvent = { type: "result"; kind: ResultKind } | { type: "sonar-ping" } | { type: "flap-far"; gaps: number };

type Listener = (e: PingEvent) => void;
const listeners = new Set<Listener>();

export const pingBus = {
  on(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(e: PingEvent) {
    for (const fn of [...listeners]) fn(e);
  },
};

/** A game finished: let Ping react. */
export function pingResult(kind: ResultKind) {
  pingBus.emit({ type: "result", kind });
}
