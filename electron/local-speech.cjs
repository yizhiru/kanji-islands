const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { createInterface } = require('node:readline');

const engines = ['kokoro', 'openjtalk'];

// One warm worker per selected engine. During a download, keep only the most
// recent waiting utterance so rapidly browsing words never fills a speech queue.
function createLocalSpeech(executable, cache, notify) {
  const workers = new Map();
  const states = new Map();
  function status(engine) {
    return (
      states.get(engine) ?? {
        state: existsSync(path.join(cache, engine, 'ready.json')) ? 'ready' : 'missing',
      }
    );
  }
  function update(engine, value) {
    states.set(engine, value);
    notify(engine, value);
  }
  function open(engine) {
    const child = spawn(executable, [engine, path.join(cache, engine)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const worker = { child, active: null, next: null };
    workers.set(engine, worker);
    function closed() {
      if (workers.get(engine) !== worker) return;
      workers.delete(engine);
      clearTimeout(worker.timer);
      for (const request of [worker.active, worker.next])
        request?.reject(new Error('朗读引擎已退出，请重试。'));
      update(engine, { state: 'error', message: '朗读引擎已退出，请重试。' });
      child.kill();
    }
    function armTimer() {
      clearTimeout(worker.timer);
      worker.timer = setTimeout(closed, 180_000);
    }
    child.on('error', closed);
    child.on('exit', closed);
    child.stdin.on('error', closed);
    child.stderr.on('data', (chunk) => console.warn('[speech]', chunk.toString().trimEnd()));
    worker.send = (request) => {
      worker.active = request;
      armTimer();
      child.stdin.write(JSON.stringify(request.text) + '\n');
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!worker.active || workers.get(engine) !== worker) return;
      try {
        const message = JSON.parse(line);
        if (message.state) {
          armTimer();
          update(engine, message);
          return;
        }
        if (message.error) {
          update(engine, { state: 'error', message: message.error });
          worker.active.reject(new Error(message.error));
        } else {
          const wav = Buffer.from(message.wav, 'base64');
          if (
            wav.length < 44 ||
            wav.length > 16 * 1024 * 1024 ||
            wav.toString('ascii', 0, 4) !== 'RIFF' ||
            wav.toString('ascii', 8, 12) !== 'WAVE'
          )
            throw new Error('Invalid waveform');
          if (status(engine).state !== 'ready') update(engine, { state: 'ready' });
          worker.active.resolve(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length));
        }
        clearTimeout(worker.timer);
        worker.active = null;
        const next = worker.next;
        worker.next = null;
        if (next) worker.send(next);
      } catch {
        closed();
      }
    });
    return worker;
  }
  return {
    statuses: () => Object.fromEntries(engines.map((engine) => [engine, status(engine)])),
    async synthesize(engine, text) {
      if (
        !engines.includes(engine) ||
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 500
      )
        throw new Error('无效的朗读请求（最多 500 字）。');
      const worker = workers.get(engine) ?? open(engine);
      if (['missing', 'error'].includes(status(engine).state))
        update(engine, { state: 'preparing' });
      return new Promise((resolve, reject) => {
        const request = { text, resolve, reject };
        if (!worker.active) worker.send(request);
        else {
          worker.next?.reject(new Error('已切换朗读内容。'));
          worker.next = request;
        }
      });
    },
    close() {
      for (const worker of workers.values()) worker.child.kill();
    },
  };
}
module.exports = { createLocalSpeech };
