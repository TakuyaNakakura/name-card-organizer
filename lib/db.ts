// Legacy timestamp/placeholder helpers only. Runtime DDL and public.cards writes are retired.
export function isPlaceholderDatabaseUrl(value: string) {
  return /:\/\/USER:PASSWORD@HOST:PORT\/DB/i.test(value);
}
export function toIsoTimestamp(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`Invalid timestamp value: ${String(value)}`);
  return parsed.toISOString();
}
