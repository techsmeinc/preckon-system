// pdf-parse ships a CJS entry whose subpath has no bundled types; we import the
// subpath to avoid its debug harness (§7.2 ingestion).
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
  }
  function pdf(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdf;
}
