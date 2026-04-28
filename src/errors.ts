export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export class DumpError extends Error {
  override readonly name = 'DumpError';
}

export class StorageError extends Error {
  override readonly name = 'StorageError';
}

export const EXIT = {
  ok: 0,
  config: 1,
  dump: 2,
  storage: 3,
  internal: 4,
} as const;

export function exitCodeFor(err: unknown): number {
  if (err instanceof ConfigError) return EXIT.config;
  if (err instanceof DumpError) return EXIT.dump;
  if (err instanceof StorageError) return EXIT.storage;
  return EXIT.internal;
}
