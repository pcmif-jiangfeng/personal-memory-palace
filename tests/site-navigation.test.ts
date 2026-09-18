import assert from "node:assert/strict";
import test from "node:test";
import { isNavigationItemActive } from "../src/components/site-navigation.ts";

test("marks gallery active for home and Memory routes only", () => {
  assert.equal(isNavigationItemActive("/", "/"), true);
  assert.equal(isNavigationItemActive("/memories/example", "/"), true);
  assert.equal(isNavigationItemActive("/memories/new", "/"), true);
  assert.equal(isNavigationItemActive("/workspace", "/"), false);
});

test("marks section navigation active for direct and nested routes", () => {
  assert.equal(isNavigationItemActive("/workspace", "/workspace"), true);
  assert.equal(isNavigationItemActive("/stages", "/stages"), true);
  assert.equal(isNavigationItemActive("/stages/example", "/stages"), true);
  assert.equal(isNavigationItemActive("/search", "/search"), true);
  assert.equal(isNavigationItemActive("/trash", "/trash"), true);
  assert.equal(isNavigationItemActive("/stages", "/workspace"), false);
});

test("does not mark unrelated public or authentication routes active", () => {
  assert.equal(isNavigationItemActive("/login", "/"), false);
  assert.equal(isNavigationItemActive("/share/token", "/"), false);
  assert.equal(isNavigationItemActive("/workspace-copy", "/workspace"), false);
});
