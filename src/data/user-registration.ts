import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { hashUserPassword } from "../security/user-password.ts";
import { createUserInDatabase, type User } from "./user-repository.ts";

export type RegisteredUser = Pick<User, "id" | "email" | "displayName" | "emailVerified">;

export function registerUserInDatabase(
  database: DatabaseSync,
  input: { email: string; password: string; displayName: string },
): RegisteredUser {
  try {
    const { id, email, displayName, emailVerified } = createUserInDatabase(database, {
      email: input.email,
      passwordHash: hashUserPassword(input.password),
      displayName: input.displayName,
    });
    return { id, email, displayName, emailVerified };
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email")) {
      throw new ApiError("EMAIL_ALREADY_REGISTERED", 409);
    }
    throw error;
  }
}
