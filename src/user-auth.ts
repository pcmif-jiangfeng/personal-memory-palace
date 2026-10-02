import { cookies } from "next/headers";
import { shouldUseSecureCookies } from "./config.ts";
import { getDatabase } from "./data/database.ts";
import { findSessionUserInDatabase, userSessionLifetimeSeconds } from "./data/user-auth.ts";
import { redirect } from "next/navigation";

export const userCookieName = "memory_palace_user";

export async function currentSessionUser() {
  const sessionToken = (await cookies()).get(userCookieName)?.value;
  return findSessionUserInDatabase(getDatabase(), sessionToken);
}

export async function currentUser() {
  const user = await currentSessionUser();
  return user?.emailVerified ? user : null;
}

export async function requireVerifiedPageUser() {
  const user = await currentSessionUser();
  if (!user) redirect("/account/login");
  if (!user.emailVerified) redirect("/verify-email");
  return user;
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
