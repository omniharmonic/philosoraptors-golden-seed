/**
 * Turning what a player types into a world seed.
 *
 * Seeds are shown to people and typed by people, so "flatirons" has to work as
 * well as "20260816". The title screen hashes words into a number before
 * putting them in the URL, but somebody will always type a word into the URL
 * directly — and silently ignoring it (falling back to the default landscape
 * with no explanation) is the worst possible response.
 */

export const DEFAULT_SEED = 20260816;

/** FNV-1a. Any text maps to a stable seed; digits are taken at face value. */
export function seedFromText(text: string): number {
  const t = String(text ?? '').trim();
  if (!t) return DEFAULT_SEED;
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n >>> 0 : DEFAULT_SEED;
  }
  let h = 2166136261 >>> 0;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Never land on 0: the authority treats a falsy seed as "not supplied".
  return (h >>> 0) || DEFAULT_SEED;
}

/** The seed this page should generate, from ?seed= (word or number). */
export function seedFromLocation(loc: Location = location): number {
  const q = new URLSearchParams(loc.search).get('seed');
  return q ? seedFromText(q) : DEFAULT_SEED;
}
