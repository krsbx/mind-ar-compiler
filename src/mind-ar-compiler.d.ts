import canvas from 'canvas';

declare global {
  interface Vector2 {
    x: number;
    y: number;
  }

  interface Vector3 extends Vector2 {
    z: number;
  }

  type ImageData = canvas.ImageData;

  interface ImageDataWithScale extends ImageData {
    scale: number;
  }
}
