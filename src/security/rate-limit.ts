type RateLimitEntry = {
  attempts: number;
  resetsAt: number;
};

const attempts = new Map<string, RateLimitEntry>();

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now = Date.now(),
): RateLimitResult {
  const current = attempts.get(key);
  const entry =
    !current || current.resetsAt <= now
      ? { attempts: 0, resetsAt: now + options.windowMs }
      : current;

  entry.attempts += 1;
  attempts.set(key, entry);
  const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetsAt - now) / 1000));
  return { allowed: entry.attempts <= options.limit, retryAfterSeconds };
}

export function clearRateLimit(key: string): void {
  attempts.delete(key);
}

export function clientRateLimitKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `${scope}:${address}`;
}

export function resetRateLimitsForTests(): void {
  attempts.clear();
}
