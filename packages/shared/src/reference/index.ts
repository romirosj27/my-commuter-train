/**
 * Demo reference data used by the mock reference adapter and the seed.
 *
 * UNVERIFIED: hand-entered for the NCL↔YRK demo route and a few large stations.
 * It is NOT a substitute for an authoritative source. The live
 * ReferenceDataSource will replace it once the source is agreed. Treat the
 * TIPLOCs in particular as needing checking against official data.
 */
import type { Operator, Station, Tiploc } from '../schemas/index.ts';

export const REFERENCE_DATA_VERIFIED = false;

export const demoStations: Station[] = [
  { crs: 'NCL', name: 'Newcastle', lat: null, lon: null },
  { crs: 'CLS', name: 'Chester-le-Street', lat: null, lon: null },
  { crs: 'DHM', name: 'Durham', lat: null, lon: null },
  { crs: 'DAR', name: 'Darlington', lat: null, lon: null },
  { crs: 'NTR', name: 'Northallerton', lat: null, lon: null },
  { crs: 'THI', name: 'Thirsk', lat: null, lon: null },
  { crs: 'YRK', name: 'York', lat: null, lon: null },
  { crs: 'LDS', name: 'Leeds', lat: null, lon: null },
  { crs: 'DON', name: 'Doncaster', lat: null, lon: null },
  { crs: 'KGX', name: 'London Kings Cross', lat: null, lon: null },
  { crs: 'EDB', name: 'Edinburgh', lat: null, lon: null },
  { crs: 'MAN', name: 'Manchester Piccadilly', lat: null, lon: null },
];

export const demoTiplocs: Tiploc[] = [
  { tiploc: 'NWCSTLE', crs: 'NCL', name: 'Newcastle' },
  { tiploc: 'CHLSTRT', crs: 'CLS', name: 'Chester-le-Street' },
  { tiploc: 'DRHM', crs: 'DHM', name: 'Durham' },
  { tiploc: 'DRLNGTN', crs: 'DAR', name: 'Darlington' },
  { tiploc: 'NTHALER', crs: 'NTR', name: 'Northallerton' },
  { tiploc: 'THIRSK', crs: 'THI', name: 'Thirsk' },
  { tiploc: 'YORK', crs: 'YRK', name: 'York' },
  { tiploc: 'LEEDS', crs: 'LDS', name: 'Leeds' },
  { tiploc: 'DONC', crs: 'DON', name: 'Doncaster' },
  { tiploc: 'KNGX', crs: 'KGX', name: 'London Kings Cross' },
  { tiploc: 'EDINBUR', crs: 'EDB', name: 'Edinburgh' },
  { tiploc: 'MNCRPIC', crs: 'MAN', name: 'Manchester Piccadilly' },
];

export const demoOperators: Operator[] = [
  { code: 'GR', name: 'LNER', claimUrl: null },
  { code: 'XC', name: 'CrossCountry', claimUrl: null },
  { code: 'NT', name: 'Northern', claimUrl: null },
  { code: 'TP', name: 'TransPennine Express', claimUrl: null },
  { code: 'GC', name: 'Grand Central', claimUrl: null },
  { code: 'LD', name: 'Lumo', claimUrl: null },
];

const tiplocToCrs = new Map(demoTiplocs.map((t) => [t.tiploc, t.crs]));
export function demoCrsForTiploc(tiploc: string): string | null {
  return tiplocToCrs.get(tiploc) ?? null;
}
