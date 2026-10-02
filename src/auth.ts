import { shouldUseSecureCookies } from "./config.ts";

const cookieName = "memory_palace_owner";
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

export { shouldUseSecureCookies };
