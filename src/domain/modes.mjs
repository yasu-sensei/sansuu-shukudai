export const MODES = [
  { name: '10までの たしひき', short: 'たしひき', mult: 1 },
  { name: '20までの くりあがり たしざん', short: 'たし算', mult: 2 },
  { name: '20までの くりさがり ひきざん', short: 'ひき算', mult: 2 },
  { name: '九九（1・2・3・5・9）', short: '九九①', mult: 2 },
  { name: '九九（4・6・7・8・9・10）', short: '九九②', mult: 3 },
];
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
}
