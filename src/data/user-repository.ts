import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readBooleanFlag, readString } from "./row-readers.ts";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  displayName: string;
}

export function createUserInDatabase(database: DatabaseSync, input: CreateUserInput): User {
  const id = randomUUID();
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.email, input.passwordHash, input.displayName, now, now);
  return findUserByIdInDatabase(database, id)!;
}

export function findUserByIdInDatabase(database: DatabaseSync, id: string): User | null {
  const row = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: readString(row, "id"),
    email: readString(row, "email"),
    passwordHash: readString(row, "password_hash"),
    displayName: readString(row, "display_name"),
    emailVerified: readBooleanFlag(row, "email_verified"),
    createdAt: readString(row, "created_at"),
    updatedAt: readString(row, "updated_at"),
  };
}
