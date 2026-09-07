/** Tiny dependency-free id helpers for the snippet (no Node crypto). */

export function randomId(prefix: string): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  // Fallback for older browsers.
  const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`;
}
