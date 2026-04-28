import { z } from 'zod';

const RetentionSchema = z
  .object({
    keep_last: z.number().int().positive(),
  })
  .strict();

const StorageSchema = z
  .object({
    path: z.string().min(1),
    retention: RetentionSchema,
  })
  .strict();

const NotificationsSchema = z
  .object({
    webhook: z.string().url(),
    on: z.array(z.enum(['failure', 'success'])).min(1).default(['failure']),
  })
  .strict();

const SchedulerSchema = z
  .object({
    max_concurrent: z.number().int().positive().default(2),
    jitter_seconds: z.number().int().nonnegative().default(0),
  })
  .strict();

const PostgresOptionsSchema = z
  .object({
    format: z.enum(['custom', 'plain', 'tar']).default('custom'),
    compress: z.number().int().min(0).max(9).default(6),
    schemas: z.array(z.string().min(1)).optional(),
    exclude_tables: z.array(z.string().min(1)).optional(),
    no_owner: z.boolean().optional(),
    no_privileges: z.boolean().optional(),
  })
  .strict();

const PostgresDatabaseSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/, {
        message: 'database name must be alphanumeric, underscore, or hyphen only',
      }),
    engine: z.literal('postgres'),
    host: z.string().min(1),
    port: z.number().int().positive().max(65535).default(5432),
    user: z.string().min(1),
    password_env: z.string().min(1).optional(),
    password_file: z.string().min(1).optional(),
    database: z.string().min(1),
    schedule: z.string().min(1),
    options: PostgresOptionsSchema.default({}),
  })
  .strict()
  .refine((db) => Boolean(db.password_env) !== Boolean(db.password_file), {
    message: 'each database must specify exactly one of password_env or password_file',
  });

export const ConfigSchema = z
  .object({
    storage: StorageSchema,
    notifications: NotificationsSchema.optional(),
    scheduler: SchedulerSchema.default({}),
    databases: z.array(PostgresDatabaseSchema).min(1),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const [i, db] of cfg.databases.entries()) {
      if (seen.has(db.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['databases', i, 'name'],
          message: `duplicate database name "${db.name}"`,
        });
      }
      seen.add(db.name);
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export type DatabaseConfig = z.infer<typeof PostgresDatabaseSchema>;
