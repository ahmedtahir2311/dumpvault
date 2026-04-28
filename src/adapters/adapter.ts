import type { Writable } from 'node:stream';

export interface Adapter {
  preflight(): Promise<void>;
  dump(out: Writable): Promise<void>;
  extension(): string;
  engine(): string;
}
