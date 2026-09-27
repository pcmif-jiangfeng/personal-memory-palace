import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isSameOriginRequest } from "../src/security/same-origin.ts";

test("accepts same-origin mutations and rejects missing or foreign origins", async () => {
  assert.equal(
    isSameOriginRequest(
      new Request("https://palace.example/api/memories", {
        method: "POST",
        headers: { origin: "https://palace.example" },
      }),
    ),
    true,
  );

  for (const origin of [undefined, "https://attacker.example"]) {
    const accepted = isSameOriginRequest(
      new Request("https://palace.example/api/memories", {
        method: "POST",
        headers: origin ? { origin } : undefined,
      }),
    );
    assert.equal(accepted, false);
  }
});

test("accepts the public host when the framework request URL uses an internal container host", () => {
  assert.equal(
    isSameOriginRequest(
      new Request("http://container-id:3000/api/auth", {
        method: "POST",
        headers: {
          host: "203.0.113.10",
          origin: "http://203.0.113.10",
        },
      }),
    ),
    true,
  );

  assert.equal(
    isSameOriginRequest(
      new Request("http://container-id:3000/api/auth", {
        method: "POST",
        headers: {
          host: "palace.example",
          origin: "https://palace.example",
          "x-forwarded-proto": "https",
        },
      }),
    ),
    true,
  );

  assert.equal(
    isSameOriginRequest(
      new Request("http://container-id:3000/api/auth", {
        method: "POST",
        headers: {
          host: "203.0.113.10",
          origin: "http://attacker.example",
        },
      }),
    ),
    false,
  );
});

test("every mutation route applies same-origin checks before authorization", () => {
  const apiDirectory = fileURLToPath(new URL("../src/app/api", import.meta.url));
  const routeFiles: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.name === "route.ts") routeFiles.push(entryPath);
    }
  };
  visit(apiDirectory);

  const mutationRoutes = routeFiles.filter((file) =>
    /export async function (POST|PUT|PATCH|DELETE)/.test(readFileSync(file, "utf8")),
  );
  assert.ok(mutationRoutes.length > 0);
  for (const file of mutationRoutes) {
    const source = readFileSync(file, "utf8");
    const originCheck = source.indexOf("sameOriginRequiredResponse(request)");
    assert.notEqual(originCheck, -1, `${path.relative(apiDirectory, file)} lacks origin checking`);
    const isInviteRoute = path.relative(apiDirectory, file).startsWith(`invites${path.sep}`);
    if (isInviteRoute) {
      assert.match(
        source,
        /(createOwnInviteInDatabase|revokeOwnInviteInDatabase|acceptInviteInDatabase)\(getDatabase\(\), user.id/,
        "Invite mutations must derive the acting User from the authenticated session",
      );
    }
    const isLeaveRoute =
      file.endsWith(path.join("leave", "route.ts")) &&
      path.relative(apiDirectory, file).startsWith(`museums${path.sep}`);
    if (isLeaveRoute) {
      assert.match(
        source,
        /leaveMuseumInDatabase\(getDatabase\(\), user.id, id\)/,
        "Leaving must only change the authenticated User's own membership",
      );
    }
    const isMuseumMemoryRoute = file.endsWith(path.join("[id]", "memories", "route.ts"));
    if (isMuseumMemoryRoute) {
      assert.match(
        source,
        /createMemoryInDatabase\(getDatabase\(\), input, \{ userId: user.id, museumId: id \}\)/,
      );
    }
    if (
      file.endsWith(path.join("museums", "route.ts")) ||
      isInviteRoute ||
      isLeaveRoute ||
      isMuseumMemoryRoute
    ) {
      const userCheck = source.indexOf("await currentUser()", originCheck);
      assert.ok(userCheck > originCheck, "Museum creation must check User after origin");
      assert.match(
        source,
        /if \(!user\).*status: 401/,
        "Museum creation must reject unauthenticated Users",
      );
      continue;
    }
    const ownerCheck = source.indexOf("await isOwner()", originCheck);
    if (
      path.relative(apiDirectory, file).startsWith(`memories${path.sep}`) ||
      path.relative(apiDirectory, file).startsWith(`stages${path.sep}`) ||
      path.relative(apiDirectory, file).startsWith(`photos${path.sep}`) ||
      file.endsWith(path.join("trash", "route.ts")) ||
      file.endsWith(path.join("shares", "route.ts"))
    ) {
      assert.ok(source.indexOf("await memoryRequestScope(request)", originCheck) > originCheck);
      continue;
    }
    if (
      !file.endsWith(path.join("auth", "route.ts")) &&
      !file.endsWith(path.join("share-access", "route.ts")) &&
      !file.endsWith(path.join("user-auth", "route.ts")) &&
      !file.endsWith(path.join("register", "route.ts")) &&
      !file.endsWith(path.join("password-reset", "request", "route.ts")) &&
      !file.endsWith(path.join("password-reset", "confirm", "route.ts")) &&
      !file.endsWith(path.join("resend-verification", "route.ts")) &&
      !file.endsWith(path.join("verify-email", "route.ts"))
    ) {
      assert.notEqual(ownerCheck, -1, `${path.relative(apiDirectory, file)} lacks owner checking`);
      assert.ok(originCheck < ownerCheck, `${path.relative(apiDirectory, file)} checks auth first`);
    }
    if (
      file.endsWith(path.join("register", "route.ts")) ||
      file.endsWith(path.join("user-auth", "route.ts")) ||
      file.endsWith(path.join("password-reset", "request", "route.ts")) ||
      file.endsWith(path.join("password-reset", "confirm", "route.ts")) ||
      file.endsWith(path.join("resend-verification", "route.ts")) ||
      file.endsWith(path.join("verify-email", "route.ts"))
    ) {
      assert.match(source, /consumeRateLimit\(/, "public account routes must be rate limited");
    }
  }
});
