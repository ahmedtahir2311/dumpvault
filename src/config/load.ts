import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from '../errors.ts';
import { type Config, ConfigSchema, type DatabaseConfig } from './schema.ts';

export type ResolvedDatabase = Omit<DatabaseConfig, 'password_env' | 'password_file'> & {
  password: string;
};

export type ResolvedConfig = Omit<Config, 'databases'> & {
  databases: ResolvedDatabase[];
};

export interface LoadOptions {
  /** Skip password resolution. For read-only commands like `status` and `history`. */
  skipSecrets?: boolean;
}

export function loadConfig(path: string, opts: LoadOptions = {}): ResolvedConfig {
  const absolute = resolve(path);

  let raw: string;
  try {
    raw = readFileSync(absolute, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`could not read config file ${absolute}: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`invalid YAML in ${absolute}: ${msg}`);
  }

  let config: Config;
  try {
    config = ConfigSchema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new ConfigError(`config schema validation failed:\n${issues}`);
    }
    throw err;
  }

  enforceFilePermissions(absolute, config);

  return {
    ...config,
    databases: config.databases.map((db) =>
      opts.skipSecrets ? stripPasswordRefs(db) : resolvePassword(db),
    ),
  };
}

function stripPasswordRefs(db: DatabaseConfig): ResolvedDatabase {
  const { password_env: _e, password_file: _f, ...rest } = db;
  return { ...rest, password: '' };
}

function enforceFilePermissions(path: string, config: Config): void {
  const usesFileRefs = config.databases.some((db) => db.password_file !== undefined);
  if (!usesFileRefs) return;

  const mode = statSync(path).mode;
  const worldReadable = (mode & 0o004) !== 0;
  if (worldReadable) {
    throw new ConfigError(
      `config file ${path} is world-readable but contains password_file references. Run: chmod 600 ${path}`,
    );
  }
}

function resolvePassword(db: DatabaseConfig): ResolvedDatabase {
  let password: string;

  if (db.password_env !== undefined) {
    const value = process.env[db.password_env];
    if (value === undefined || value === '') {
      throw new ConfigError(`env var ${db.password_env} for database "${db.name}" is not set`);
    }
    password = value;
  } else if (db.password_file !== undefined) {
    const filePath = resolve(expandHome(db.password_file));
    try {
      password = readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigError(
        `could not read password_file ${filePath} for database "${db.name}": ${msg}`,
      );
    }
    if (password === '') {
      throw new ConfigError(`password_file ${filePath} for database "${db.name}" is empty`);
    }
  } else {
    throw new ConfigError(`database "${db.name}" has no password source`);
  }

  const { password_env: _e, password_file: _f, ...rest } = db;
  return { ...rest, password };
}

export function expandHome(p: string): string {
  if (p === '~') return process.env.HOME ?? p;
  if (p.startsWith('~/')) return resolve(process.env.HOME ?? '', p.slice(2));
  return p;
}
