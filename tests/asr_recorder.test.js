import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { planAsrSegments } from '../extension/core/asr-progress.js';

test('offscreen recorder advances from a 10-second segment to the next one-minute segment', async () => {
  const source = (
    await readFile(new URL('../extension/offscreen/recorder.js', import.meta.url), 'utf8')
  ).replace(/^import [^\n]+\n/gm, '');
  const messages = [];
  const timers = new Map();
  let listener;
  let playhead = 0;
  let timerId = 0;
  class Recorder {
    state = 'inactive';
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob([new Uint8Array(1500)], { type: 'audio/webm' }) });
      this.onstop();
    }
  }
  class Audio {
    createMediaStreamSource() {
      return { connect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        connect() {},
        getByteTimeDomainData(samples) {
          samples.fill(140);
        },
      };
    }
    async resume() {}
    async close() {}
    get destination() {
      return {};
    }
  }
  const context = {
    AbortController,
    prepareSpeechAudio: async (blob) => blob,
    isQwenAsr: () => false,
    AudioContext: Audio,
    Blob,
    MediaRecorder: Recorder,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getAudioTracks: () => [{ addEventListener() {} }],
          getTracks: () => [{ stop() {} }],
        }),
      },
    },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval() {
      return ++timerId;
    },
    clearInterval() {},
    transcribe: async () => [{ start: 0, end: 2, text: 'Recognized.' }],
    chrome: {
      runtime: {
        id: 'fixture',
        getURL: (path) => `chrome-extension://fixture/${path}`,
        onMessage: {
          addListener(fn) {
            listener = fn;
          },
        },
        async sendMessage(message) {
          messages.push(message);
          return message.type === 'CAPTURE_POSITION'
            ? { ok: true, data: { time: playhead, duration: 80, paused: false, rate: 1 } }
            : { ok: true };
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const sender = { id: 'fixture', url: 'chrome-extension://fixture/background.js' };
  const command = (type, fields = {}) =>
    new Promise((resolve) => {
      listener({ target: 'offscreen', type, recordId: 'video', ...fields }, sender, resolve);
    });
  const flush = async (predicate) => {
    for (let i = 0; i < 60 && !predicate(); i++) await new Promise(setImmediate);
    assert.ok(predicate(), 'recorder did not reach the expected stage');
  };
  const plan = planAsrSegments(0, 70);
  assert.equal((await command('START', { streamId: 'stream', settings: {}, plan })).ok, true);
  assert.equal((await command('RUN')).ok, true);
  await flush(() => messages.some((m) => m.type === 'ASR_PROGRESS' && m.status === 'capturing'));
  assert.equal([...timers.values()][0].ms, 10000);
  playhead = 10;
  [...timers.values()][0].fn();
  await flush(() => messages.some((m) => m.type === 'ASR_CHUNK' && m.segmentId === plan[0].id));
  const recognizing = messages.find(
    (m) => m.type === 'ASR_PROGRESS' && m.segmentId === plan[0].id && m.status === 'recognizing',
  );
  assert.equal(recognizing.audioBytes, 1500);
  assert.ok(recognizing.audioLevel > 0.09);
  await flush(() =>
    messages.some(
      (m) => m.type === 'ASR_PROGRESS' && m.segmentId === plan[1].id && m.status === 'capturing',
    ),
  );
  assert.equal([...timers.values()][0].ms, 60000);
  playhead = 70;
  [...timers.values()][0].fn();
  await flush(() => messages.some((m) => m.type === 'ASR_FINISHED'));
  const chunks = messages.filter((m) => m.type === 'ASR_CHUNK');
  assert.deepEqual(
    chunks.map((m) => [m.segmentId, m.segments[0].start]),
    [
      [plan[0].id, 0],
      [plan[1].id, 10],
    ],
  );
  assert.deepEqual(
    chunks.map((m) => m.capturedEnd),
    [10, 70],
  );
  assert.equal(messages.at(-1).type, 'ASR_FINISHED');
});

test('a timed-out ASR chunk fails once, stops capture, and preserves a retryable segment', async () => {
  const source = (
    await readFile(new URL('../extension/offscreen/recorder.js', import.meta.url), 'utf8')
  ).replace(/^import [^\n]+\n/gm, '');
  const messages = [];
  const timers = new Map();
  let listener;
  let playhead = 0;
  let calls = 0;
  let timerId = 0;
  class Recorder {
    state = 'inactive';
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob([new Uint8Array(1500)], { type: 'audio/webm' }) });
      this.onstop();
    }
  }
  class Audio {
    createMediaStreamSource() {
      return { connect() {} };
    }
    async resume() {}
    async close() {}
    get destination() {
      return {};
    }
  }
  const context = {
    AbortController,
    prepareSpeechAudio: async (blob) => blob,
    isQwenAsr: () => false,
    AudioContext: Audio,
    Blob,
    MediaRecorder: Recorder,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getAudioTracks: () => [{ addEventListener() {} }],
          getTracks: () => [{ stop() {} }],
        }),
      },
    },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    clearInterval() {},
    async transcribe(_blob, _settings, _signal, _filename, options) {
      calls++;
      assert.equal(options.timeoutMs, 45000);
      throw new Error('ASR 请求超过 45 秒仍无响应');
    },
    chrome: {
      runtime: {
        id: 'fixture',
        getURL: (path) => `chrome-extension://fixture/${path}`,
        onMessage: {
          addListener(fn) {
            listener = fn;
          },
        },
        async sendMessage(message) {
          messages.push(message);
          return message.type === 'CAPTURE_POSITION'
            ? { ok: true, data: { time: playhead, duration: 80, paused: false, rate: 1 } }
            : { ok: true };
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const sender = { id: 'fixture', url: 'chrome-extension://fixture/background.js' };
  const command = (type, fields = {}) =>
    new Promise((resolve) => {
      listener({ target: 'offscreen', type, recordId: 'video', ...fields }, sender, resolve);
    });
  const plan = planAsrSegments(0, 80);
  assert.equal((await command('START', { streamId: 'stream', settings: {}, plan })).ok, true);
  assert.equal((await command('RUN')).ok, true);
  playhead = 20;
  [...timers.values()][0].fn();
  for (let i = 0; i < 60 && !messages.some((m) => m.type === 'ASR_FINISHED'); i++)
    await new Promise(setImmediate);
  assert.equal(calls, 1, 'the same timed-out chunk must not be charged or retried twice');
  assert.ok(
    messages.some(
      (m) =>
        m.type === 'ASR_PROGRESS' &&
        m.segmentId === plan[0].id &&
        m.status === 'failed' &&
        m.error.includes('45 秒'),
    ),
  );
  assert.equal(messages.filter((m) => m.type === 'ASR_CHUNK').length, 0);
  assert.equal(messages.at(-1).type, 'ASR_FINISHED');
  assert.match(messages.at(-1).error, /45 秒/);
});
