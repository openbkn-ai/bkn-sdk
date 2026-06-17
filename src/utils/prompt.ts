/** Interactive TTY prompts shared across commands. */
import { createInterface } from "node:readline";

/**
 * Prompt for a single line on the TTY. When `hidden`, the typed characters are
 * not echoed (for passwords): the query is printed once and keystrokes are
 * swallowed.
 */
export function promptLine(query: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Swallow the echo of typed chars; print the query once up front.
      const mutable = rl as unknown as { _writeToOutput: (s: string) => void };
      mutable._writeToOutput = (s: string) => {
        if (s.startsWith(query)) process.stdout.write(query);
      };
    }
    rl.question(query, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}
