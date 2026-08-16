/** Parse `#rgb` or `#rrggbb` into an [r, g, b] triple, 0-255. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16
  );
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
