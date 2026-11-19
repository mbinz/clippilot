export const TIERS = ['hero', 'solid', 'filler'] as const;
export type Tier = (typeof TIERS)[number];

/** Higher is better: hero 3, solid 2, filler 1. Unknown values rank 0. */
export function tierRank(tier: string | null | undefined): number {
  const i = TIERS.indexOf(tier as Tier);
  return i === -1 ? 0 : TIERS.length - i;
}

/** SQL fragment ranking a tier column the same way as tierRank. */
export function tierRankSql(column: string): string {
  return `CASE ${column} WHEN 'hero' THEN 3 WHEN 'solid' THEN 2 WHEN 'filler' THEN 1 ELSE 0 END`;
}

export function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}
