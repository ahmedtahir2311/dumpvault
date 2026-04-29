import { z } from 'zod';

const RetentionSchema = z
  .object({
    keep_last: z.number().int().nonnegative().optional(),
    keep_daily: z.number().int().nonnegative().optional(),
    keep_weekly: z.number().int().nonnegative().optional(),
    keep_monthly: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (r) =>
      (r.keep_last ?? 0) + (r.keep_daily ?? 0) + (r.keep_weekly ?? 0) + (r.keep_monthly ?? 0) > 0,
    {
      message:
        'retention: at least one of keep_last / keep_daily / keep_weekly / keep_monthly must be > 0',
    },
  );

const EncryptionSchema = z
  .object({
    enabled: z.boolean(),
    key_file: z.string().min(1),
  })
  .strict();

const StorageSchema = z
  .object({
    path: z.string().min(1),
    encryption: EncryptionSchema.optional(),
    retention: RetentionSchema,
  })
  .strict();

const NotificationsSchema = z
  .object({
    webhook: z.string().url(),
    on: z
      .array(z.enum(['failure', 'success']))
      .min(1)
      .default(['failure']),
  })
  .strict();

const SchedulerSchema = z
  .object({
    max_concurrent: z.number().int().positive().default(2),
    jitter_seconds: z.number().int().nonnegative().default(0),
  })
  .strict();

// ── Per-engine option schemas ─────────────────────────────────────────────────

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

const MysqlOptionsSchema = z
  .object({
    /** mysqldump --single-transaction. Default true for InnoDB safety. */
    single_transaction: z.boolean().default(true),
    /** mysqldump --routines (include stored procedures + functions). */
    routines: z.boolean().default(true),
    /** mysqldump --triggers. Default true (matches mysqldump default). */
    triggers: z.boolean().default(true),
    /** mysqldump --events. Default false because most projects don't use them. */
    events: z.boolean().default(false),
    /** Schema-only dump (no row data). */
    no_data: z.boolean().optional(),
    /** Add DROP TABLE before each CREATE TABLE. */
    add_drop_table: z.boolean().optional(),
    /** Tables to exclude (one --ignore-table=db.table per entry). */
    exclude_tables: z.array(z.string().min(1)).optional(),
    /** SSL mode passed to mysqldump --ssl-mode. */
    ssl_mode: z
      .enum(['DISABLED', 'PREFERRED', 'REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY'])
      .optional(),
  })
  .strict();

// ── Per-engine database schemas ───────────────────────────────────────────────

const databaseNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'database name must be alphanumeric, underscore, or hyphen only',
  });

const PostgresDatabaseSchema = z
  .object({
    name: databaseNameSchema,
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
  .strict();

const MysqlDatabaseSchema = z
  .object({
    name: databaseNameSchema,
    engine: z.literal('mysql'),
    host: z.string().min(1),
    port: z.number().int().positive().max(65535).default(3306),
    user: z.string().min(1),
    password_env: z.string().min(1).optional(),
    password_file: z.string().min(1).optional(),
    database: z.string().min(1),
    schedule: z.string().min(1),
    options: MysqlOptionsSchema.default({}),
  })
  .strict();

const DatabaseSchema = z.discriminatedUnion('engine', [
  PostgresDatabaseSchema,
  MysqlDatabaseSchema,
]);

// ── Top-level config ──────────────────────────────────────────────────────────

export const ConfigSchema = z
  .object({
    storage: StorageSchema,
    notifications: NotificationsSchema.optional(),
    scheduler: SchedulerSchema.default({}),
    databases: z.array(DatabaseSchema).min(1),
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

      if (Boolean(db.password_env) === Boolean(db.password_file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['databases', i],
          message: 'each database must specify exactly one of password_env or password_file',
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseSchema>;
export type PostgresDatabase = z.infer<typeof PostgresDatabaseSchema>;
export type MysqlDatabase = z.infer<typeof MysqlDatabaseSchema>;
