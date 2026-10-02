import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { planAsrSegments } from '../extension/core/asr-progress.js';

test('audio-only recording covers a long video with overlapping playable clips and no ASR calls', async () => {
  const source = (
    await readFile(new URL('../extension/offscreen/recorder.js', import.meta.url), 'utf8')
  ).replace(/^import [^\n]+\n/gm, '');
  let listener;
  let playhead = 0;
  let transcribes = 0;
  const clips = [];
  const messages = [];
  class Recorder {
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({ data: new Blob([new Uint8Array(1500)], { type: 'audio/webm' }) });
      this.onstop();
    }
  }
  class Audio {
    createMediaStreamSource() { return { connect() {} }; }
    async resume() {}
    async close() {}
    get destination() { return {}; }
  }
  const context = {
    AbortController, Blob, MediaRecorder: Recorder, AudioContext: Audio, crypto: globalThis.crypto,
    saveAudio: async clip => { clips.push(clip); },
    transcribe: async () => { transcribes++; return []; },
    prepareSpeechAudio: async blob => blob, isQwenAsr: () => false,
    navigator: { mediaDevices: { getUserMedia: async () => ({
      getAudioTracks: () => [{ addEventListener() {} }], getTracks: () => [{ stop() {} }],
    }) } },
    setTimeout(fn, ms) { playhead = Math.min(130, playhead + ms / 1000); queueMicrotask(fn); return 1; },
    clearTimeout() {}, clearInterval() {}, setInterval() { return 1; },
    chrome: { runtime: { id: 'fixture', getURL: path => `chrome-extension://fixture/${path}`,
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(message) {
        messages.push(message);
        return message.type === 'CAPTURE_POSITION'
          ? { ok: true, data: { time: playhead, duration: 130, paused: false, rate: 1 } }
          : { ok: true };
      },
    } },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const sender = { id: 'fixture', url: 'chrome-extension://fixture/background.js' };
  const command = (type, fields = {}) => new Promise(resolve => {
    listener({ target: 'offscreen', type, recordId: 'video', ...fields }, sender, resolve);
  });
  assert.equal((await command('START', { streamId: 'stream', settings: {}, audioOnly: true,
    videoKey: 'migu:event:programme', plan: [{ id: 'whole', start: 0, end: 130 }] })).ok, true);
  assert.equal((await command('RUN')).ok, true);
  for (let i = 0; i < 100 && !messages.some(m => m.type === 'ASR_FINISHED'); i++)
    await new Promise(setImmediate);
  assert.ok(messages.some(m => m.type === 'ASR_FINISHED'));
  assert.equal(transcribes, 0);
  assert.equal(clips.length, 2);
  assert.equal(clips[0].start, 0);
  assert.ok(clips[1].start < clips[0].end, 'clips overlap to prevent a boundary gap');
  assert.equal(clips[1].end, 130);
});

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
    saveAudio: async () => {},
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
  const savedAudio = [];
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
    saveAudio: async (clip) => savedAudio.push(clip),
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
  assert.ok(savedAudio.length >= 1, 'a failed ASR request must retain the captured clip');
  assert.equal(savedAudio[0].start, 0);
  assert.equal(messages.at(-1).type, 'ASR_FINISHED');
  assert.match(messages.at(-1).error, /45 秒/);
});

test('a silent chunk is saved as no speech without calling ASR or stopping later chunks', async () => {
  const source = (
    await readFile(new URL('../extension/offscreen/recorder.js', import.meta.url), 'utf8')
  ).replace(/^import [^\n]+\n/gm, '');
  const messages = [],
    timers = new Map();
  let listener,
    playhead = 0,
    timerId = 0,
    calls = 0;
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
          samples.fill(128);
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
    AudioContext: Audio,
    Blob,
    MediaRecorder: Recorder,
    saveAudio: async () => {},
    prepareSpeechAudio: async (blob) => blob,
    isQwenAsr: () => true,
    transcribe: async () => {
      calls++;
      throw new Error('silent audio must not be sent');
    },
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
    assert.ok(predicate());
  };
  const plan = planAsrSegments(0, 70);
  assert.equal((await command('START', { streamId: 'stream', settings: {}, plan })).ok, true);
  assert.equal((await command('RUN')).ok, true);
  await flush(() => messages.some((m) => m.type === 'ASR_PROGRESS' && m.status === 'capturing'));
  playhead = 10;
  [...timers.values()][0].fn();
  await flush(() => messages.some((m) => m.type === 'ASR_CHUNK' && m.segmentId === plan[0].id));
  await flush(() =>
    messages.some(
      (m) => m.type === 'ASR_PROGRESS' && m.segmentId === plan[1].id && m.status === 'capturing',
    ),
  );
  assert.equal(calls, 0);
  assert.equal(messages.find((m) => m.type === 'ASR_CHUNK').segments.length, 0);
  assert.equal(
    messages.some((m) => m.type === 'ASR_PROGRESS' && m.status === 'failed'),
    false,
  );
  playhead = 70;
  [...timers.values()][0].fn();
  await flush(() => messages.some((m) => m.type === 'ASR_FINISHED'));
  assert.equal(messages.filter((m) => m.type === 'ASR_CHUNK').length, 2);
  assert.equal(calls, 0);
});
