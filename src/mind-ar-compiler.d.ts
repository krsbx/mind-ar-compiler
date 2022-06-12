declare global {
  interface Vector2 {
    x: number;
    y: number;
  }

  interface Vector3 extends Vector2 {
    z: number;
  }
}
