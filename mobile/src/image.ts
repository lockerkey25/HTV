import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_SIDE = 1536;

/** Downscale so the longest side is <= 1536px and re-encode as JPEG before upload. */
export async function prepareForUpload(uri: string, width: number, height: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_SIDE) {
    ctx.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const ref = await ctx.renderAsync();
  const result = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  return result.uri;
}
