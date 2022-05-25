// result should be similar to previous
// improve freka descriptors computation
import * as tf from '@tensorflow/tfjs';
import { GPGPUProgram, MathBackendWebGL } from '@tensorflow/tfjs-backend-webgl';
import {
  FREAK_CONPARISON_COUNT,
  MAX_FEATURES_PER_BUCKET,
  NUM_BUCKETS_PER_DIMENSION,
  ORIENTATION_GAUSSIAN_EXPANSION_FACTOR,
  ORIENTATION_REGION_EXPANSION_FACTOR,
  ORIENTATION_SMOOTHING_ITERATIONS,
  PYRAMID_MAX_OCTAVE,
  PYRAMID_MIN_SIZE,
} from '../utils/constant/detector';
import { FREAKPOINTS } from '../utils/constant/freak';
import { IMaximaMinimaPoint } from '../utils/types/compiler';
import { IDebugExtra } from '../utils/types/detector';
import * as Helper from '../utils/helper';
import { DetectorKernel } from '../utils/kernels';

class Detector {
  private debugMode: boolean;
  private width: number;
  private height: number;
  private numOctaves: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tensorCaches: Record<any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private kernelCaches: Record<any, any>;

  constructor(width: number, height: number, debugMode = false) {
    this.debugMode = debugMode;
    this.width = width;
    this.height = height;

    let numOctaves = 0;

    while (width >= PYRAMID_MIN_SIZE && height >= PYRAMID_MIN_SIZE) {
      width /= 2;
      height /= 2;
      numOctaves++;

      if (numOctaves === PYRAMID_MAX_OCTAVE) break;
    }

    this.numOctaves = numOctaves;

    this.tensorCaches = {};
    this.kernelCaches = {};
  }

  // used in compiler
  detectImageData(imageData: number[]) {
    const arr = new Uint8ClampedArray(4 * imageData.length);

    for (let i = 0; i < imageData.length; i++) {
      arr[4 * i] = imageData[i];
      arr[4 * i + 1] = imageData[i];
      arr[4 * i + 2] = imageData[i];
      arr[4 * i + 3] = 255;
    }

    const img = Helper.castTo<tf.Tensor<tf.Rank>>(new ImageData(arr, this.width, this.height));

    return this.detect(img);
  }

  detect(inputImageT: tf.Tensor<tf.Rank>) {
    let debugExtra: IDebugExtra = {} as IDebugExtra;

    // Build gaussian pyramid images, two images per octave
    const pyramidImagesT: tf.Tensor<tf.Rank>[][] = [];

    for (let i = 0; i < this.numOctaves; i++) {
      let image1T: tf.Tensor<tf.Rank>;

      if (i === 0) image1T = this._applyFilter(inputImageT);
      else
        image1T = this._downsampleBilinear(pyramidImagesT[i - 1][pyramidImagesT[i - 1].length - 1]);

      const image2T = this._applyFilter(image1T);

      pyramidImagesT.push([image1T, image2T]);
    }

    // Build difference-of-gaussian (dog) pyramid
    const dogPyramidImagesT: tf.Tensor<tf.Rank>[] = [];

    for (let i = 0; i < this.numOctaves; i++) {
      const dogImageT = this._differenceImageBinomial(pyramidImagesT[i][0], pyramidImagesT[i][1]);

      dogPyramidImagesT.push(dogImageT);
    }

    // find local maximum/minimum
    const extremasResultsT: tf.Tensor<tf.Rank>[] = [];

    for (let i = 1; i < this.numOctaves - 1; i++) {
      const extremasResultT = this._buildExtremas(
        dogPyramidImagesT[i - 1],
        dogPyramidImagesT[i],
        dogPyramidImagesT[i + 1]
      );

      extremasResultsT.push(extremasResultT);
    }

    // divide the input into N by N buckets, and for each bucket,
    // collect the top 5 most significant extrema across extremas in all scale level
    // result would be NUM_BUCKETS x NUM_FEATURES_PER_BUCKET extremas
    const prunedExtremasList = this._applyPrune(extremasResultsT);

    const prunedExtremasT = this._computeLocalization(prunedExtremasList, dogPyramidImagesT);

    // compute the orientation angle for each pruned extremas
    const extremaHistogramsT = this._computeOrientationHistograms(prunedExtremasT, pyramidImagesT);
    const smoothedHistogramsT = this._smoothHistograms(extremaHistogramsT);
    const extremaAnglesT = this._computeExtremaAngles(smoothedHistogramsT);

    // to compute freak descriptors, we first find the pixel value of 37 freak points for each extrema
    const extremaFreaksT = this._computeExtremaFreak(
      pyramidImagesT,
      prunedExtremasT,
      extremaAnglesT
    );

    // compute the binary descriptors
    const freakDescriptorsT = this._computeFreakDescriptors(extremaFreaksT);

    const prunedExtremasArr = prunedExtremasT.arraySync() as number[][];
    const extremaAnglesArr = extremaAnglesT.arraySync() as number[];
    const freakDescriptorsArr = freakDescriptorsT.arraySync() as number[][];

    if (this.debugMode) {
      debugExtra = {
        pyramidImages: pyramidImagesT.map((ts) => ts.map((t) => t.arraySync())) as number[][],
        dogPyramidImages: dogPyramidImagesT.map((t) => (t ? t.arraySync() : null)) as
          | number[]
          | null[],
        extremasResults: extremasResultsT.map((t) => t.arraySync()) as number[],
        extremaAngles: extremaAnglesT.arraySync() as number[],
        prunedExtremas: prunedExtremasList,
        localizedExtremas: prunedExtremasT.arraySync() as number[][],
      } as IDebugExtra;
    }

    pyramidImagesT.forEach((ts) => ts.forEach((t) => t.dispose()));
    dogPyramidImagesT.forEach((t) => t && t.dispose());
    extremasResultsT.forEach((t) => t.dispose());
    prunedExtremasT.dispose();
    extremaHistogramsT.dispose();
    smoothedHistogramsT.dispose();
    extremaAnglesT.dispose();
    extremaFreaksT.dispose();
    freakDescriptorsT.dispose();

    const featurePoints: IMaximaMinimaPoint[] = [];

    for (let i = 0; i < prunedExtremasArr.length; i++) {
      if (prunedExtremasArr[i][0] == 0) continue;

      const descriptors: number[] = [];

      for (let m = 0; m < freakDescriptorsArr[i].length; m += 4) {
        const v1 = freakDescriptorsArr[i][m];
        const v2 = freakDescriptorsArr[i][m + 1];
        const v3 = freakDescriptorsArr[i][m + 2];
        const v4 = freakDescriptorsArr[i][m + 3];

        const combined = v1 * 16777216 + v2 * 65536 + v3 * 256 + v4;

        descriptors.push(combined);
      }

      const octave = prunedExtremasArr[i][1];
      const y = prunedExtremasArr[i][2];
      const x = prunedExtremasArr[i][3];
      const originalX = x * Math.pow(2, octave) + Math.pow(2, octave - 1) - 0.5;
      const originalY = y * Math.pow(2, octave) + Math.pow(2, octave - 1) - 0.5;
      const scale = Math.pow(2, octave);

      featurePoints.push({
        maxima: prunedExtremasArr[i][0] > 0,
        x: originalX,
        y: originalY,
        scale,
        angle: extremaAnglesArr[i],
        descriptors: descriptors,
      });
    }

    return { featurePoints, debugExtra };
  }

  private _computeFreakDescriptors(extremaFreaks: tf.Tensor<tf.Rank>) {
    if (!this.tensorCaches.computeFreakDescriptors) {
      const in1Arr: number[] = [];
      const in2Arr: number[] = [];

      const freaksWidth = extremaFreaks.shape[1] as number;

      for (let k1 = 0; k1 < freaksWidth; k1++) {
        for (let k2 = k1 + 1; k2 < freaksWidth; k2++) {
          in1Arr.push(k1);
          in2Arr.push(k2);
        }
      }

      const in1 = tf.tensor(in1Arr, [in1Arr.length]).cast('int32');
      const in2 = tf.tensor(in2Arr, [in2Arr.length]).cast('int32');

      this.tensorCaches.computeFreakDescriptors = {
        positionT: tf.keep(tf.stack([in1, in2], 1)),
      };
    }

    const { positionT } = this.tensorCaches.computeFreakDescriptors;

    // encode 8 bits into one number
    // trying to encode 16 bits give wrong result in iOS. may integer precision issue
    const descriptorCount = Math.ceil(FREAK_CONPARISON_COUNT / 8);

    if (!this.kernelCaches.computeFreakDescriptors) {
      this.kernelCaches.computeFreakDescriptors = DetectorKernel.computeFreakDescriptors(
        extremaFreaks,
        descriptorCount,
        FREAK_CONPARISON_COUNT
      );
    }

    return tf.tidy(() => {
      const [program] = this.kernelCaches.computeFreakDescriptors;

      return this._runWebGLProgram(program, [extremaFreaks, positionT], 'int32');
    });
  }

  private _computeExtremaFreak(
    pyramidImagesT: tf.Tensor<tf.Rank>[][],
    prunedExtremas: tf.Tensor<tf.Rank>,
    prunedExtremasAngles: tf.Tensor<tf.Rank>
  ) {
    if (!this.tensorCaches._computeExtremaFreak)
      tf.tidy(() => {
        const freakPoints = tf.tensor(FREAKPOINTS);
        this.tensorCaches._computeExtremaFreak = {
          freakPointsT: tf.keep(freakPoints),
        };
      });

    const { freakPointsT } = this.tensorCaches._computeExtremaFreak;

    const gaussianImagesT: tf.Tensor<tf.Rank>[] = [];

    for (let i = 1; i < pyramidImagesT.length; i++) gaussianImagesT.push(pyramidImagesT[i][1]); // better

    if (!this.kernelCaches._computeExtremaFreak) {
      this.kernelCaches._computeExtremaFreak = DetectorKernel.computeExtremaFreak(
        pyramidImagesT,
        prunedExtremas
      );
    }

    return tf.tidy(() => {
      const [program] = this.kernelCaches._computeExtremaFreak;
      const result = this._compileAndRun(program, [
        ...gaussianImagesT,
        prunedExtremas,
        prunedExtremasAngles,
        freakPointsT,
      ]);

      return result;
    });
  }

  private _computeExtremaAngles(histograms: tf.Tensor<tf.Rank>) {
    if (!this.kernelCaches.computeExtremaAngles) {
      this.kernelCaches.computeExtremaAngles = DetectorKernel.computeExtremaAngles(histograms);
    }

    return tf.tidy(() => {
      const program = this.kernelCaches.computeExtremaAngles;

      return this._compileAndRun(program, [histograms]);
    });
  }

  // TODO: maybe can try just using average momentum, instead of histogram method. histogram might be overcomplicated
  private _computeOrientationHistograms(
    prunedExtremasT: tf.Tensor<tf.Rank>,
    pyramidImagesT: tf.Tensor<tf.Rank>[][]
  ) {
    const oneOver2PI = 0.159154943091895;

    const gaussianImagesT: tf.Tensor<tf.Rank>[] = [];

    for (let i = 1; i < pyramidImagesT.length; i++) gaussianImagesT.push(pyramidImagesT[i][1]);

    if (!this.tensorCaches.orientationHistograms) {
      tf.tidy(() => {
        const gwScale =
          -1.0 /
          (2 * ORIENTATION_GAUSSIAN_EXPANSION_FACTOR * ORIENTATION_GAUSSIAN_EXPANSION_FACTOR);
        const radius = ORIENTATION_GAUSSIAN_EXPANSION_FACTOR * ORIENTATION_REGION_EXPANSION_FACTOR;
        const radiusCeil = Math.ceil(radius);

        const radialProperties = [];
        for (let y = -radiusCeil; y <= radiusCeil; y++) {
          for (let x = -radiusCeil; x <= radiusCeil; x++) {
            const distanceSquare = x * x + y * y;

            // may just assign w = 1 will do, this could be over complicated.
            if (distanceSquare <= radius * radius) {
              const _x = distanceSquare * gwScale;
              // fast expontenial approx
              const w =
                (720 + _x * (720 + _x * (360 + _x * (120 + _x * (30 + _x * (6 + _x)))))) *
                0.0013888888;

              radialProperties.push([y, x, w]);
            }
          }
        }

        this.tensorCaches.orientationHistograms = {
          radialPropertiesT: tf.keep(tf.tensor(radialProperties, [radialProperties.length, 3])),
        };
      });
    }

    const { radialPropertiesT } = this.tensorCaches.orientationHistograms;

    if (!this.kernelCaches.computeOrientationHistograms) {
      this.kernelCaches.computeOrientationHistograms = DetectorKernel.computeOrientationHistograms(
        pyramidImagesT,
        prunedExtremasT,
        radialPropertiesT,
        oneOver2PI
      );
    }

    return tf.tidy(() => {
      const [program1, program2] = this.kernelCaches.computeOrientationHistograms;

      const result1 = this._compileAndRun(program1, [
        ...gaussianImagesT,
        prunedExtremasT,
        radialPropertiesT,
      ]);

      const result2 = this._compileAndRun(program2, [result1]);

      return result2;
    });
  }

  // The histogram is smoothed with a Gaussian, with sigma = 1
  private _smoothHistograms(histograms: tf.Tensor<tf.Rank>) {
    if (!this.kernelCaches.smoothHistograms) {
      this.kernelCaches.smoothHistograms = DetectorKernel.smoothHistograms(histograms);
    }

    return tf.tidy(() => {
      const program = this.kernelCaches.smoothHistograms;

      for (let i = 0; i < ORIENTATION_SMOOTHING_ITERATIONS; i++)
        histograms = this._compileAndRun(program, [histograms]);

      return histograms;
    });
  }

  private _computeLocalization(
    prunedExtremasList: number[][],
    dogPyramidImagesT: tf.Tensor<tf.Rank>[]
  ) {
    if (!this.kernelCaches.computeLocalization) {
      this.kernelCaches.computeLocalization = DetectorKernel.computeLocalization(
        dogPyramidImagesT,
        prunedExtremasList
      );
    }

    return tf.tidy(() => {
      const program = this.kernelCaches.computeLocalization[0];
      const prunedExtremasT = tf.tensor(
        prunedExtremasList,
        [prunedExtremasList.length, prunedExtremasList[0].length],
        'int32'
      );

      const pixelsT = this._compileAndRun(program, [
        ...dogPyramidImagesT.slice(1),
        prunedExtremasT,
      ]);

      const pixels = pixelsT.arraySync() as number[][][];

      const result: number[][][] = [];

      for (let i = 0; i < pixels.length; i++) {
        result.push([]);

        for (let j = 0; j < pixels[i].length; j++) result[i].push([]);
      }

      const localizedExtremas = [];
      for (let i = 0; i < prunedExtremasList.length; i++) {
        localizedExtremas[i] = [
          prunedExtremasList[i][0],
          prunedExtremasList[i][1],
          prunedExtremasList[i][2],
          prunedExtremasList[i][3],
        ];
      }

      for (let i = 0; i < localizedExtremas.length; i++) {
        if (localizedExtremas[i][0] === 0) continue;

        const pixel = pixels[i];
        const dx = 0.5 * (pixel[1][2] - pixel[1][0]);
        const dy = 0.5 * (pixel[2][1] - pixel[0][1]);
        const dxx = pixel[1][2] + pixel[1][0] - 2 * pixel[1][1];
        const dyy = pixel[2][1] + pixel[0][1] - 2 * pixel[1][1];
        const dxy = 0.25 * (pixel[0][0] + pixel[2][2] - pixel[0][2] - pixel[2][0]);

        const det = dxx * dyy - dxy * dxy;
        const ux = (dyy * -dx + -dxy * -dy) / det;
        const uy = (-dxy * -dx + dxx * -dy) / det;

        const newY = localizedExtremas[i][2] + uy;
        const newX = localizedExtremas[i][3] + ux;

        if (Math.abs(det) < 0.0001) continue;

        localizedExtremas[i][2] = newY;
        localizedExtremas[i][3] = newX;
      }
      return tf.tensor(
        localizedExtremas,
        [localizedExtremas.length, localizedExtremas[0].length],
        'float32'
      );
    });
  }

  // faster to do it in CPU
  // if we do in gpu, we probably need to use tf.topk(), which seems to be run in CPU anyway (no gpu operation for that)
  //  TODO: research adapative maximum supression method
  private _applyPrune(extremasResultsT: tf.Tensor<tf.Rank>[]) {
    const nBuckets = NUM_BUCKETS_PER_DIMENSION * NUM_BUCKETS_PER_DIMENSION;
    const nFeatures = MAX_FEATURES_PER_BUCKET;

    if (!this.kernelCaches.applyPrune) {
      const reductionKernels: GPGPUProgram[] = [];

      // to reduce to amount of data that need to sync back to CPU by 4 times, we apply this trick:
      // the fact that there is not possible to have consecutive maximum/minimum, we can safe combine 4 pixels into 1
      for (let k = 0; k < extremasResultsT.length; k++) {
        const extremaHeight = extremasResultsT[k].shape[0] as number;
        const extremaWidth = extremasResultsT[k].shape[1] as number;

        reductionKernels.push(DetectorKernel.applyPrune(extremaHeight, extremaWidth));
      }

      this.kernelCaches.applyPrune = { reductionKernels };
    }

    // combine results into a tensor of:
    //   nBuckets x nFeatures x [score, octave, y, x]
    const curAbsScores: number[][] = [];
    const result: number[][][] = [];

    for (let i = 0; i < nBuckets; i++) {
      result.push([]);
      curAbsScores.push([]);

      for (let j = 0; j < nFeatures; j++) {
        result[i].push([0, 0, 0, 0]);
        curAbsScores[i].push(0);
      }
    }

    tf.tidy(() => {
      const { reductionKernels } = this.kernelCaches.applyPrune;

      for (let k = 0; k < extremasResultsT.length; k++) {
        const program = reductionKernels[k];
        const reducedT = this._compileAndRun(program, [extremasResultsT[k]]);

        const octave = k + 1; // extrema starts from second octave

        const reduced = reducedT.arraySync() as number[][];
        const height = reducedT.shape[0] as number;
        const width = reducedT.shape[1] as number;

        const bucketWidth = (width * 2) / NUM_BUCKETS_PER_DIMENSION;
        const bucketHeight = (height * 2) / NUM_BUCKETS_PER_DIMENSION;

        for (let j = 0; j < height; j++) {
          for (let i = 0; i < width; i++) {
            const encoded = reduced[j][i];
            if (encoded == 0) continue;

            const score = encoded % 1000;
            const loc = Math.floor(Math.abs(encoded) / 1000);
            const x = i * 2 + (loc === 2 || loc === 3 ? 1 : 0);
            const y = j * 2 + (loc === 1 || loc === 3 ? 1 : 0);

            const bucketX = Math.floor(x / bucketWidth);
            const bucketY = Math.floor(y / bucketHeight);
            const bucket = bucketY * NUM_BUCKETS_PER_DIMENSION + bucketX;

            const absScore = Math.abs(score);

            let tIndex = nFeatures;
            while (tIndex >= 1 && absScore > curAbsScores[bucket][tIndex - 1]) tIndex -= 1;

            if (tIndex < nFeatures) {
              for (let t = nFeatures - 1; t >= tIndex + 1; t--) {
                curAbsScores[bucket][t] = curAbsScores[bucket][t - 1];
                result[bucket][t][0] = result[bucket][t - 1][0];
                result[bucket][t][1] = result[bucket][t - 1][1];
                result[bucket][t][2] = result[bucket][t - 1][2];
                result[bucket][t][3] = result[bucket][t - 1][3];
              }

              curAbsScores[bucket][tIndex] = absScore;
              result[bucket][tIndex][0] = score;
              result[bucket][tIndex][1] = octave;
              result[bucket][tIndex][2] = y;
              result[bucket][tIndex][3] = x;
            }
          }
        }
      }
    });

    // combine all buckets into a single list
    const list: number[][] = [];
    for (let i = 0; i < nBuckets; i++) {
      for (let j = 0; j < nFeatures; j++) list.push(result[i][j]);
    }

    return list;
  }

  private _buildExtremas(
    image0: tf.Tensor<tf.Rank>,
    image1: tf.Tensor<tf.Rank>,
    image2: tf.Tensor<tf.Rank>
  ) {
    const imageHeight = image1.shape[0] as number;
    const imageWidth = image1.shape[1] as number;

    const kernelKey = 'w' + imageWidth;

    if (!this.kernelCaches.buildExtremas) this.kernelCaches.buildExtremas = {};

    if (!this.kernelCaches.buildExtremas[kernelKey]) {
      this.kernelCaches.buildExtremas[kernelKey] = DetectorKernel.buildExtremas(
        imageHeight,
        imageWidth
      );
    }

    return tf.tidy(() => {
      const program = this.kernelCaches.buildExtremas[kernelKey];
      image0 = this._downsampleBilinear(image0);
      image2 = this._upsampleBilinear(image2, image1);

      return this._compileAndRun(program, [image0, image1, image2]);
    });
  }

  private _differenceImageBinomial(image1: tf.Tensor<tf.Rank>, image2: tf.Tensor<tf.Rank>) {
    return tf.tidy(() => {
      return image1.sub(image2);
    });
  }

  // 4th order binomail filter [1,4,6,4,1] X [1,4,6,4,1]
  private _applyFilter(image: tf.Tensor<tf.Rank>) {
    const imageHeight = image.shape[0] as number;
    const imageWidth = image.shape[1] as number;

    const kernelKey = 'w' + imageWidth;
    if (!this.kernelCaches.applyFilter) this.kernelCaches.applyFilter = {};

    if (!this.kernelCaches.applyFilter[kernelKey]) {
      this.kernelCaches.applyFilter[kernelKey] = DetectorKernel.applyFilter(
        imageHeight,
        imageWidth
      );
    }

    return tf.tidy(() => {
      const [program1, program2] = this.kernelCaches.applyFilter[kernelKey];

      const result1 = this._compileAndRun(program1, [image]);
      const result2 = this._compileAndRun(program2, [result1]);
      return result2;
    });
  }

  private _upsampleBilinear(image: tf.Tensor<tf.Rank>, targetImage: tf.Tensor<tf.Rank>) {
    const imageWidth = image.shape[1] as number;

    const kernelKey = 'w' + imageWidth;
    if (!this.kernelCaches.upsampleBilinear) this.kernelCaches.upsampleBilinear = {};

    if (!this.kernelCaches.upsampleBilinear[kernelKey]) {
      this.kernelCaches.upsampleBilinear[kernelKey] = DetectorKernel.upsampleBilinear(
        targetImage.shape[0] as number,
        targetImage.shape[1] as number
      );
    }

    return tf.tidy(() => {
      const program = this.kernelCaches.upsampleBilinear[kernelKey];
      return this._compileAndRun(program, [image]);
    });
  }

  private _downsampleBilinear(image: tf.Tensor<tf.Rank>) {
    const imageHeight = image.shape[0] as number;
    const imageWidth = image.shape[1] as number;

    const kernelKey = 'w' + imageWidth;
    if (!this.kernelCaches.downsampleBilinear) this.kernelCaches.downsampleBilinear = {};

    if (!this.kernelCaches.downsampleBilinear[kernelKey]) {
      this.kernelCaches.downsampleBilinear[kernelKey] = DetectorKernel.downsampleBilinear(
        imageHeight,
        imageWidth
      );
    }

    return tf.tidy(() => {
      const program = this.kernelCaches.downsampleBilinear[kernelKey];
      return this._compileAndRun(program, [image]);
    });
  }

  private _compileAndRun(program: GPGPUProgram, inputs: tf.TensorInfo[]) {
    const outInfo = (tf.backend() as MathBackendWebGL).compileAndRun(program, inputs);

    return tf.engine().makeTensorFromTensorInfo(outInfo);
  }

  private _runWebGLProgram(
    program: GPGPUProgram,
    inputs: tf.TensorInfo[],
    outputType: keyof tf.DataTypeMap
  ) {
    const outInfo = (tf.backend() as MathBackendWebGL).runWebGLProgram(program, inputs, outputType);

    return tf.engine().makeTensorFromTensorInfo(outInfo);
  }
}

export { Detector };
