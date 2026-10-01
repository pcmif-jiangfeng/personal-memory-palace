import { publicSiteUrl } from "../domain/share-links.ts";

export function accountEmailLink(page: "verify-email" | "reset-password", token: string): string {
  // Local tokens belong to the local database, not the production website.
  const base = process.env.NODE_ENV === "development" ? "http://localhost:3000/" : publicSiteUrl;
  return `${new URL(page, base).href}#${token}`;
}
