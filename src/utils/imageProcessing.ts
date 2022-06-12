import sharp from 'sharp';
import * as Helper from './helper';

const loadImage = async (filepath: string) => sharp(filepath);

const getImageData = async (filepath: string): Promise<ImageData | null> => {
  const image = await loadImage(filepath);
  const metadata = await image.metadata();

  if (Helper.isNil(metadata.height) || Helper.isNil(metadata.width)) return null;

  const imageData = {
    data: (await image.raw().toBuffer()).toJSON()['data'],
    height: metadata.height,
    width: metadata.width,
  };

  return imageData;
};

export { getImageData };
