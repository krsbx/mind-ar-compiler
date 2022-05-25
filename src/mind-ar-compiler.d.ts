interface Vector2 {
  x: number;
  y: number;
}

interface Vector3 extends Vector2 {
  z: number;
}

interface ImageData {
  data: Uint8ClampedArray | number[];
  height: number;
  width: number;
}

interface ImageDataWithScale extends ImageData {
  scale: number;
}
