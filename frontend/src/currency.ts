// Currency helpers — Philippine peso
export const CURRENCY_SYMBOL = "₱";

export function fmtPHP(amount: number, options: { withSymbol?: boolean } = {}): string {
  const withSymbol = options.withSymbol !== false;
  const rounded = Math.round(amount);
  const parts = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return withSymbol ? `${CURRENCY_SYMBOL}${parts}` : parts;
}
