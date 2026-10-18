/** libheif-js WASM bundle 的最小类型声明（包内 .mjs 入口没有配套 d.ts） */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number
    get_height(): number
    display(imageData: ImageData, callback: (data: ImageData | null) => void): void
  }
  export interface HeifDecoder {
    /** 解析 HEIF 容器，返回其中所有图像的句柄（不解码像素，display 时才解） */
    decode(data: Uint8Array): HeifImage[]
  }
  export interface LibHeifModule {
    HeifDecoder: new () => HeifDecoder
  }
  /** emscripten MODULARIZE 工厂：node 下同步返回模块，浏览器下返回 Promise<模块> */
  const factory: (options?: unknown) => LibHeifModule | Promise<LibHeifModule>
  export default factory
}
