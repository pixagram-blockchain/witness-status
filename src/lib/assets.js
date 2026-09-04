// Asset and timestamp parsing shared by every other module.
// hived returns assets either as legacy strings ("1.000 PIXA") from condenser_api
// or as NAI objects ({amount, precision, nai}) from database_api.

export const NAI = { '@@000000021': 'PIXA', '@@000000013': 'PXS', '@@000000037': 'VESTS' };
export const EPOCH = '1970-01-01T00:00:00';

export function parseAsset(a) {
  if (a == null) return null;
  if (typeof a === 'string') {
    const [num, symbol] = a.trim().split(/\s+/);
    return { amount: Number(num), symbol };
  }
  return { amount: Number(a.amount) / 10 ** a.precision, symbol: NAI[a.nai] ?? a.nai };
}

// hived timestamps are UTC without a zone suffix; Date.parse would treat them as local time.
export function parseUtc(ts) {
  if (!ts) return NaN;
  return Date.parse(ts.endsWith('Z') ? ts : ts + 'Z');
}

export function isEpoch(ts) {
  return !ts || ts.startsWith('1970-01-01');
}
