import extract from './tracker/extract';
import { buildTrackingImageList } from './image-list';
import { ImageDataWithScale, ITrackingFeature } from './utils/types/compiler';

const _extractTrackingFeatures = (
  imageList: ImageDataWithScale[],
  doneCallback: (iteration: number) => void
) => {
  const featureSets: ITrackingFeature[] = [];

  for (const [i, image] of imageList.entries()) {
    const points = extract(image);

    const featureSet = {
      data: image.data,
      scale: image.scale,
      width: image.width,
      height: image.height,
      points,
    } as ITrackingFeature;

    featureSets.push(featureSet);

    doneCallback(i);
  }

  return featureSets;
};

class ImageCompiler {
  private list: ITrackingFeature[][] = [];

  constructor(targetImages: ImageData[]) {
    const percentPerImage = 50.0 / targetImages.length;

    let percent = 0.0;

    for (const targetImage of targetImages) {
      const imageList = buildTrackingImageList(targetImage);
      const percentPerAction = percentPerImage / imageList.length;

      const trackingData = _extractTrackingFeatures(<ImageDataWithScale[]>imageList, () => {
        percent += percentPerAction;
        console.log(`Percent: ${percent}`);
      });

      this.list.push(trackingData);
    }
  }

  public getList() {
    return this.list;
  }
}

export default ImageCompiler;
