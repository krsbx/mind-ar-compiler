import sharp from 'sharp';

interface ImageData {
  data: Uint8ClampedArray | number[];
  height: number;
  width: number;
}

const loadImage = async (filepath: string) => sharp(filepath);

const getImageData = async (filepath: string): Promise<ImageData> => {
  const image = await loadImage(filepath);
  const metadata = await image.metadata();

  const imageData = {
    data: (await image.raw().toBuffer()).toJSON()['data'],
    height: metadata.height,
    width: metadata.width,
  } as ImageData;

  return imageData;
};

export { getImageData };
