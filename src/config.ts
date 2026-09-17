import path from "node:path";

export type Dataset = "demo" | "owner";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function getDatasetConfig(): Dataset {
  const value = process.env.MEMORY_PALACE_DATASET ?? "demo";
  if (value !== "demo" && value !== "owner") {
    throw new ConfigurationError("MEMORY_PALACE_DATASET must be demo or owner");
  }
  return value;
}

export function getDataDirectory(): string {
  return process.env.MEMORY_PALACE_DATA_DIR
    ? path.resolve(/* turbopackIgnore: true */ process.env.MEMORY_PALACE_DATA_DIR)
    : path.join(process.cwd(), "data");
}

export function getOwnerPassword(): string | null {
  const password = process.env.MEMORY_PALACE_OWNER_PASSWORD?.trim();
  return password || null;
}

export function getSessionSecret(): string {
  const secret = process.env.MEMORY_PALACE_SESSION_SECRET?.trim();
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new ConfigurationError(
      "MEMORY_PALACE_SESSION_SECRET must contain at least 32 characters in production",
    );
  }
  return "development-only-memory-palace-session-secret";
}

export function shouldUseSecureCookies(): boolean {
  const value = process.env.MEMORY_PALACE_SECURE_COOKIES;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== undefined) {
    throw new ConfigurationError("MEMORY_PALACE_SECURE_COOKIES must be true or false");
  }
  return process.env.NODE_ENV === "production";
}
