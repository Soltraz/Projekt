declare module "mammoth/mammoth.browser" {
  export function convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: any
  ): Promise<{ value: string; messages: any[] }>;
}
