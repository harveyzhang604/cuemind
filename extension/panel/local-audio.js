import { getAudio } from '../storage/audio.js';
export function clipAt(clips, time) {
  return clips
    .filter((c) => c.start <= time + 0.025 && c.end > time + 0.025)
    .sort((a, b) => b.end - a.end || b.savedAt - a.savedAt)[0];
}
export function coversRange(clips, start, end) {
  let at = start;
  while (at < end - 0.025) {
    const clip = clipAt(clips, at);
    if (!clip) return false;
    at = clip.end;
  }
  return end > start;
}
export class LocalAudioPlayer {
  constructor(onState, onError, audio = new Audio(), readClip = getAudio) {
    this.readClip = readClip;
    this.audio = audio;
    this.onState = onState;
    this.onError = onError;
    this.clips = [];
    this.at = 0;
    this.serial = 0;
    audio.addEventListener('timeupdate', () => this.tick());
    audio.addEventListener('ended', () => this.advance().catch(onError));
    audio.addEventListener('pause', () => this.emit());
    audio.addEventListener('play', () => this.emit());
    audio.addEventListener('error', () => onError(new Error('本地音频无法解码，请导出该片段检查')));
  }
  setClips(clips, videoKey) {
    this.dispose();
    this.clips = clips;
    this.videoKey = videoKey;
    this.at = clips[0]?.start || 0;
  }
  snapshot() {
    return {
      videoKey: this.videoKey,
      time: this.at,
      duration: Math.max(0, ...this.clips.map((c) => c.end)),
      paused: this.audio.paused,
      rate: this.audio.playbackRate,
      session: !!this.ranges,
      rangeStart: this.ranges?.[this.index]?.start,
      rangeEnd: this.ranges?.[this.index]?.end,
      repeat: this.repeat || 1,
      readyState: 4,
    };
  }
  emit(event) {
    this.onState({ ...this.snapshot(), playbackEvent: event });
  }
  dispose() {
    this.serial++;
    this.ranges = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.clip = null;
  }
  async seek(time) {
    const clip = clipAt(this.clips, time);
    if (!clip) throw new Error('此位置尚无本地音频；请回原视频采集这段后再学习。');
    const token = ++this.serial;
    if (this.clip?.id !== clip.id) {
      this.audio.pause();
      const data = await this.readClip(clip.id);
      if (token !== this.serial) return;
      if (!data?.blob) throw new Error('本地音频已删除');
      if (this.url) URL.revokeObjectURL(this.url);
      this.url = URL.createObjectURL(data.blob);
      this.clip = clip;
      this.audio.src = this.url;
      await new Promise((resolve, reject) => {
        const done = () => {
            clean();
            resolve();
          },
          fail = () => {
            clean();
            reject(new Error('本地音频读取失败'));
          };
        const timer = setTimeout(fail, 10000);
        const clean = () => {
          clearTimeout(timer);
          this.audio.removeEventListener('loadedmetadata', done);
          this.audio.removeEventListener('error', fail);
        };
        this.audio.addEventListener('loadedmetadata', done, { once: true });
        this.audio.addEventListener('error', fail, { once: true });
        this.audio.load();
      });
    }
    if (token !== this.serial) return;
    this.at = time;
    this.audio.currentTime = Math.max(0, time - clip.start);
    this.emit('seeked');
  }
  tick() {
    if (!this.clip) return;
    this.at = Math.min(this.clip.end, this.clip.start + this.audio.currentTime);
    this.emit();
    if (this.at >= (this.ranges?.[this.index]?.end ?? this.clip.end) - 0.03)
      this.advance().catch(this.onError);
  }
  async advance() {
    if (this.advancing) return;
    this.advancing = true;
    try {
      const wasPlaying = !this.audio.paused || this.audio.ended;
      const range = this.ranges?.[this.index];
      if (range && this.at >= range.end - 0.05) {
        this.audio.pause();
        this.index++;
        if (this.index === this.ranges.length) {
          this.round++;
          this.index = 0;
          if (this.repeat !== -1 && this.round >= this.repeat) {
            this.ranges = null;
            this.emit();
            return;
          }
        }
        await this.seek(this.ranges[this.index].start);
        await this.audio.play();
        return;
      }
      const next = clipAt(this.clips, this.clip.end);
      if (next) {
        await this.seek(this.clip.end);
        if (wasPlaying) await this.audio.play();
      } else {
        this.audio.pause();
        this.ranges = null;
        this.emit();
      }
    } finally {
      this.advancing = false;
    }
  }
  async command(m) {
    if (['state', 'bind', 'keyboard', 'focusCaptions'].includes(m.action)) return this.snapshot();
    if (m.action === 'repeat') {
      this.repeat = m.repeat;
      return true;
    }
    if (['stop', 'pause'].includes(m.action)) {
      this.ranges = null;
      this.audio.pause();
      return true;
    }
    if (m.action === 'rate') {
      this.audio.playbackRate = m.rate;
      return true;
    }
    if (m.action === 'seek') {
      this.ranges = null;
      await this.seek(m.time);
      return true;
    }
    if (m.action === 'play' || m.action === 'toggle') {
      if (m.action === 'toggle' && !this.audio.paused) {
        this.audio.pause();
        return true;
      }
      if (!this.clip) await this.seek(this.at);
      await this.audio.play();
      return true;
    }
    if (m.action === 'range') {
      const ranges = m.ranges || [{ start: m.start, end: m.end }];
      if (!ranges.every((r) => coversRange(this.clips, r.start, r.end)))
        throw new Error('所选句子有未保存的音频，无法完整复听。请先采集缺失片段。');
      this.ranges = ranges;
      this.repeat = m.repeat ?? 1;
      this.index = 0;
      this.round = 0;
      await this.seek(ranges[0].start);
      await this.audio.play();
      return true;
    }
    throw new Error('本地音频不支持此操作');
  }
}
