export const STREAMED_CONTENT_MAX = 48_000;

export function capStreamedContent(value: string): string {
  if (value.length <= STREAMED_CONTENT_MAX) return value;
  return value.slice(value.length - STREAMED_CONTENT_MAX);
}
