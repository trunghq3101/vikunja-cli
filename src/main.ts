import { runCli } from './cli';
import { securityKeychain } from './keychain';
import { terminalPrompter } from './prompt';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  process.stderr.write(
    `${JSON.stringify({ error: { title: `Node.js 20 or newer is required (found ${process.versions.node})` } })}\n`,
  );
  process.exit(3);
}

runCli(process.argv.slice(2), {
  env: process.env,
  keychain: securityKeychain(),
  fetch: (url, init) => fetch(url, init),
  io: {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  },
  prompter: terminalPrompter(),
}).then((code) => {
  process.exitCode = code;
});
