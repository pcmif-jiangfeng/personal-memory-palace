import { cookies } from "next/headers";
import { shouldUseSecureCookies } from "./config.ts";
import {
  createOwnerSessionToken,
  isOwnerPasswordValid,
  ownerPasswordConfigured,
  ownerSessionLifetimeSeconds,
  verifyOwnerSessionToken,
} from "./security/owner-session.ts";

const cookieName = "memory_palace_owner";
export async function isOwner(): Promise<boolean> {
  return verifyOwnerSessionToken((await cookies()).get(cookieName)?.value);
}

export function ownerCookie() {
  return {
    name: cookieName,
    value: createOwnerSessionToken(),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: ownerSessionLifetimeSeconds,
  };
}

export function expiredOwnerCookie() {
  return {
    name: cookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 0,
  };
}

export {
  cookieName,
  createOwnerSessionToken,
  isOwnerPasswordValid,
  ownerPasswordConfigured,
  shouldUseSecureCookies,
  verifyOwnerSessionToken,
};
