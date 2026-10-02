export const nicknameMaxLength = 50;

export function normalizeNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim();
  return nickname && nickname.length <= nicknameMaxLength ? nickname : null;
}

export function accountDisplayLabel(user: { displayName: string; email: string }): string {
  return user.displayName.trim() || user.email;
}
