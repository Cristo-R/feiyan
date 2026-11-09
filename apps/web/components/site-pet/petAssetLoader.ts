const assetPromises = new Map<string, Promise<HTMLImageElement>>();
const decodedAssets = new Map<string, HTMLImageElement>();

export function isPetAssetReady(src: string) {
  return decodedAssets.has(src);
}

export function getPetAssetDisplayUrl(src: string) {
  return decodedAssets.get(src)?.src ?? '';
}

export function loadPetAsset(src: string): Promise<HTMLImageElement> {
  const cached = assetPromises.get(src);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Failed to load pet asset: ${src} (${response.status})`);
    const blob = await response.blob();
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = async () => {
        try {
          await image.decode();
        } catch {
          // Some browsers report a decode error after a successful load even though the bitmap is usable.
        }
        decodedAssets.set(src, image);
        resolve(image);
      };
      image.onerror = () => reject(new Error(`Failed to load pet asset: ${src}`));
      image.src = URL.createObjectURL(blob);
    });
  })();

  assetPromises.set(src, promise);
  promise.catch(() => assetPromises.delete(src));
  return promise;
}

export async function warmPetAssets(sources: string[], concurrency = 2) {
  const queue = [...new Set(sources)].filter(src => !decodedAssets.has(src));
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const src = queue.shift();
      if (!src) return;
      try {
        await loadPetAsset(src);
      } catch {
        // A later interaction retries failed assets instead of failing the entire warm-up queue.
      }
    }
  });
  await Promise.all(workers);
}
