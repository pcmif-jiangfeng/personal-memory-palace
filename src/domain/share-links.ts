export const publicSiteUrl = "https://memorymuseum.top/";

export function publicMemoryUrl(memoryId: string): string {
  return new URL("memories/" + encodeURIComponent(memoryId), publicSiteUrl).href;
}
