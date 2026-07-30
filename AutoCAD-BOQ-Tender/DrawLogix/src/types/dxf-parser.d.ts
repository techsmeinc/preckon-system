declare module "dxf-parser" {
  // Loose types — we only read entities/vertices/text from the parsed result.
  // biome-ignore lint/suspicious/noExplicitAny: third-party parser has no shipped types
  type Dxf = any;
  export default class DxfParser {
    parseSync(source: string): Dxf;
    parse(source: string): Dxf;
  }
}
