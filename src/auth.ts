import { createHash } from "node:crypto";
import { cookies } from "next/headers";

const cookieName = "memory_palace_owner";
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function ownerPasswordConfigured() { return Boolean(process.env.MEMORY_PALACE_OWNER_PASSWORD); }
export function isOwnerPasswordValid(password: string) { return ownerPasswordConfigured() && password === process.env.MEMORY_PALACE_OWNER_PASSWORD; }
export async function isOwner() { return (await cookies()).get(cookieName)?.value === digest(process.env.MEMORY_PALACE_OWNER_PASSWORD ?? ""); }
export function useSecureCookies(): boolean {
  if (process.env.MEMORY_PALACE_SECURE_COOKIES === "true") return true;
  if (process.env.MEMORY_PALACE_SECURE_COOKIES === "false") return false;
  return process.env.NODE_ENV === "production";
}
export function ownerCookie() { return { name: cookieName, value: digest(process.env.MEMORY_PALACE_OWNER_PASSWORD ?? ""), httpOnly: true, sameSite: "lax" as const, secure: useSecureCookies(), path: "/", maxAge: 60 * 60 * 24 * 30 }; }
export { cookieName };
