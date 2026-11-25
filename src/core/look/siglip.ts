import os from 'node:os';
import path from 'node:path';

/** Real embedder: SigLIP base image model through transformers.js, cached in ~/.clippilot/models. */
export const SIGLIP_MODEL_ID = 'Xenova/siglip-base-patch16-224';
export const SIGLIP_APPROX_DOWNLOAD = '~370 MB';
export const LOOK_MODEL_DIR = path.join(os.homedir(), '.clippilot', 'models', 'transformers');

export async function createSiglipEmbedder(opts: { modelId?: string; onFirstDownload?: (approx: string) => void } = {}) {
  const modelId = opts.modelId ?? SIGLIP_MODEL_ID;
  const { AutoProcessor, CLIPVisionModelWithProjection, SiglipVisionModel, RawImage, env } = await import('@huggingface/transformers') as any;
  env.cacheDir = LOOK_MODEL_DIR;
  const fs = await import('node:fs');
  const cached = fs.existsSync(path.join(LOOK_MODEL_DIR, ...modelId.split('/')));
  if (!cached) opts.onFirstDownload?.(SIGLIP_APPROX_DOWNLOAD);
  const processor = await AutoProcessor.from_pretrained(modelId);
  const ModelClass = modelId.includes('siglip') ? SiglipVisionModel : CLIPVisionModelWithProjection;
  const model = await ModelClass.from_pretrained(modelId);
  return {
    model: modelId,
    async embed(images: Buffer[]): Promise<Float32Array[]> {
      const out: Float32Array[] = [];
      for (const buf of images) {
        const img = await RawImage.fromBlob(new Blob([new Uint8Array(buf)]));
        const inputs = await processor(img);
        const res = await model(inputs);
        const t = res.image_embeds ?? res.pooler_output;
        out.push(Float32Array.from(t.data as ArrayLike<number>));
      }
      return out;
    },
  };
}
