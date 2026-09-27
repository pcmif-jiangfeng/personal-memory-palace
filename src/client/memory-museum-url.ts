// The selected Museum is a target only; the server always rechecks membership.
export function memoryMuseumUrl(url: string, selectedMuseumId?: string) {
  const museumId =
    selectedMuseumId ??
    (typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("museumId"));
  return museumId
    ? `${url}${url.includes("?") ? "&" : "?"}museumId=${encodeURIComponent(museumId)}`
    : url;
}
