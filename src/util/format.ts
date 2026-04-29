export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > max) max = cell.length;
    }
    return max;
  });
  const line = (cols: string[]): string => cols.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
  console.log(line(headers));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) {
    console.log(line(row.map((c) => c ?? '')));
  }
}
