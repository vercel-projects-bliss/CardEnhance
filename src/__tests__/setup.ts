if (typeof ImageData === "undefined") {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace = "srgb";
    constructor(dataOrW: Uint8ClampedArray | number, width?: number, height?: number) {
      if (typeof dataOrW === "number") {
        this.width = dataOrW;
        this.height = width ?? 0;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = dataOrW;
        this.width = width ?? 0;
        this.height = height ?? 0;
      }
    }
  }
  (globalThis as unknown as { ImageData: typeof ImageData }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}
