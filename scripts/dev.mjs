import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
const server = await createServer();
await server.listen();
server.printUrls();
const env = { ...process.env, KANJI_DEV_URL: 'http://127.0.0.1:5173/' };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = spawn(electron, ['.'], { stdio: 'inherit', env });
const close = async () => {
  desktop.kill();
  await server.close();
};
desktop.on('exit', async (code) => {
  await server.close();
  process.exitCode = code ?? 0;
});
process.on('SIGINT', close);
process.on('SIGTERM', close);
