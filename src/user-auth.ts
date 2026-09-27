import { cookies } from "next/headers";
import { shouldUseSecureCookies } from "./config.ts";
import { getDatabase } from "./data/database.ts";
import { findUserBySessionInDatabase, userSessionLifetimeSeconds } from "./data/user-auth.ts";

export const userCookieName = "memory_palace_user";

export async function currentUser() {
  const sessionToken = (await cookies()).get(userCookieName)?.value;
  return findUserBySessionInDatabase(getDatabase(), sessionToken);
}

export function userSessionCookie(value: string) {
  return {
    name: userCookieName,
    value,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: userSessionLifetimeSeconds,
  };
}

export function expiredUserSessionCookie() {
  return { ...userSessionCookie(""), maxAge: 0 };
}
