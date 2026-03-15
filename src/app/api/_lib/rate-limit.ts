const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

interface RateLimitEntry {
  attempts: number;
  lockedUntil: number;
}

const MAX_ENTRIES = 10_000;
const rateLimitMap = new Map<string, RateLimitEntry>();

// Periodic cleanup of expired entries to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (entry.lockedUntil <= now && entry.attempts >= MAX_LOGIN_ATTEMPTS) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60 * 1000);

export function checkRateLimit(ip: string): string | null {
  const entry = rateLimitMap.get(ip);
  if (!entry) return null;
  if (entry.lockedUntil > Date.now()) {
    const remainingMin = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    return `Too many login attempts. Try again in ${remainingMin} minute(s).`;
  }
  if (entry.lockedUntil <= Date.now() && entry.attempts >= MAX_LOGIN_ATTEMPTS) {
    rateLimitMap.delete(ip);
  }
  return null;
}

export function recordFailedAttempt(ip: string): void {
  // Evict oldest entry if at capacity
  if (!rateLimitMap.has(ip) && rateLimitMap.size >= MAX_ENTRIES) {
    const firstKey = rateLimitMap.keys().next().value;
    if (firstKey) rateLimitMap.delete(firstKey);
  }
  const entry = rateLimitMap.get(ip) ?? { attempts: 0, lockedUntil: 0 };
  entry.attempts += 1;
  if (entry.attempts >= MAX_LOGIN_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  rateLimitMap.set(ip, entry);
}

export function clearAttempts(ip: string): void {
  rateLimitMap.delete(ip);
}
