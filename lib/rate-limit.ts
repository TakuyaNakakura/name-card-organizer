interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitInput {
  key: string;
  identifier: string;
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

function getBucketKey(input: RateLimitInput) {
  return `${input.key}:${input.identifier}`;
}

function getOrCreateBucket(input: RateLimitInput) {
  const bucketKey = getBucketKey(input);
  const now = Date.now();
  const current = buckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    const nextBucket = {
      count: 0,
      resetAt: now + input.windowMs
    };
    buckets.set(bucketKey, nextBucket);
    return nextBucket;
  }

  return current;
}

function pruneExpiredBuckets() {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export function isRateLimited(input: RateLimitInput) {
  pruneExpiredBuckets();
  const bucket = buckets.get(getBucketKey(input));
  if (!bucket) {
    return false;
  }

  return bucket.count >= input.limit && bucket.resetAt > Date.now();
}

export function incrementRateLimit(input: RateLimitInput): RateLimitResult {
  pruneExpiredBuckets();
  const bucket = getOrCreateBucket(input);
  bucket.count += 1;

  return {
    limited: bucket.count >= input.limit,
    remaining: Math.max(input.limit - bucket.count, 0),
    resetAt: bucket.resetAt
  };
}

export function consumeRateLimit(input: RateLimitInput): RateLimitResult {
  pruneExpiredBuckets();
  const bucket = getOrCreateBucket(input);
  bucket.count += 1;

  return {
    limited: bucket.count > input.limit,
    remaining: Math.max(input.limit - bucket.count, 0),
    resetAt: bucket.resetAt
  };
}

export function resetRateLimit(input: RateLimitInput) {
  buckets.delete(getBucketKey(input));
}
