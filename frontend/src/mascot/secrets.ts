/** Ping's secrets (just for fun, no rewards). Pure helpers; the live mascot wires them up. */

/** Type this anywhere (outside text fields) and he answers. */
export const ECHO_WORD = "ping";
/** The click of a visit that sends him to sleep. */
export const NAP_AT = 10;
/** Signal Flap: he cheers at every multiple of this many gaps. */
export const FLAP_CHEER_EVERY = 25;

/** Feed one key into the typed-word buffer; `hit` when the word is complete. */
export function echoKey(buf: string, key: string): { buf: string; hit: boolean } {
  if (key.length !== 1 || !/[a-z]/i.test(key)) return { buf: "", hit: false };
  const next = (buf + key.toLowerCase()).slice(-ECHO_WORD.length);
  return next === ECHO_WORD ? { buf: "", hit: true } : { buf: next, hit: false };
}

/** Night owl hours: midnight to 5 am, your local time. */
export function isNight(d: Date): boolean {
  return d.getHours() < 5;
}
