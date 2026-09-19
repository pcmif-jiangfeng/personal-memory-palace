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
    const ownerCheck = source.indexOf("await isOwner()", originCheck);
    if (
      !file.endsWith(path.join("auth", "route.ts")) &&
      !file.endsWith(path.join("share-access", "route.ts"))
    ) {
      assert.notEqual(ownerCheck, -1, `${path.relative(apiDirectory, file)} lacks owner checking`);
      assert.ok(originCheck < ownerCheck, `${path.relative(apiDirectory, file)} checks auth first`);
    }
  }
});
