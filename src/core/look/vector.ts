/** Component-wise mean of the vectors, scaled to unit length (a zero mean stays zero). */
export function averageNormalize(vectors: Float32Array[]): Float32Array {
  const n = vectors[0]!.length;
  const out = new Float32Array(n);
  for (const v of vectors) for (let i = 0; i < n; i++) out[i]! += v[i]! / vectors.length;
  let norm = 0;
  for (let i = 0; i < n; i++) norm += out[i]! * out[i]!;
  norm = Math.sqrt(norm);
  if (norm > 1e-12) for (let i = 0; i < n; i++) out[i]! /= norm; else out.fill(0);
  return out;
}
