import { createInterface } from 'node:readline';

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'cannot prompt for confirmation: stdin is not a TTY. Re-run with --yes to skip the prompt.',
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} [y/N] `, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}
