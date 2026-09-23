export function imageVariantUrl(
  src: string,
  variant: "thumbnail" | "preview" = "thumbnail",
): string {
  if (!src.startsWith("/media/uploads/")) return src;
  return `${src}${src.includes("?") ? "&" : "?"}variant=${variant}`;
}
