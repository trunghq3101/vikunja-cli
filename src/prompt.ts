import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import type { Prompter } from './context';

export function terminalPrompter(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): Prompter {
  let piped: { rl: Interface; lines: AsyncIterator<string> } | undefined;

  return {
    async ask(question, options = {}) {
      if (!input.isTTY) {
        // Piped input (e.g. `pbpaste | vikunja profile add bot`): one line per question, no prompt text.
        if (!piped) {
          const rl = createInterface({ input, terminal: false });
          piped = { rl, lines: rl[Symbol.asyncIterator]() };
        }
        const next = await piped.lines.next();
        return next.done ? '' : next.value.trim();
      }

      let muted = false;
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          if (!muted) output.write(chunk);
          callback();
        },
      });
      const rl = createInterface({ input, output: sink, terminal: true });
      rl.on('SIGINT', () => {
        rl.close();
        output.write('\n');
        process.exit(130);
      });
      try {
        const answer = new Promise<string>((resolve) => rl.question(question, resolve));
        muted = Boolean(options.hidden); // question text is already written; hide what the user types
        const value = await answer;
        if (options.hidden) output.write('\n');
        return value.trim();
      } finally {
        rl.close();
      }
    },

    close() {
      piped?.rl.close();
    },
  };
}
