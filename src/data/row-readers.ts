function invalidColumn(key: string, expected: string): TypeError {
  return new TypeError(`Invalid database column ${key}; expected ${expected}`);
}

export function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw invalidColumn(key, "string");
  return value;
}

export function readNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw invalidColumn(key, "string or null");
  return value;
}

export function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidColumn(key, "finite number");
  }
  return value;
}

export function readBooleanFlag(row: Record<string, unknown>, key: string): boolean {
  const value = readNumber(row, key);
  if (value !== 0 && value !== 1) throw invalidColumn(key, "0 or 1");
  return value === 1;
}
