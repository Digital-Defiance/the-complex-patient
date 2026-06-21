export function shadeHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return hex;
  }
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  const next = channels.map((channel) => {
    const value = Math.round(channel + 255 * amount);
    return Math.min(255, Math.max(0, value));
  });
  return `#${next.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
