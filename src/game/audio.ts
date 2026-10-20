// WebAudio sound set: a tiny synth for the Suika-style drop / pop / game_over cues (pitch of the
// merge "pop" falls with tier, like the per-size pops in clones) plus per-tier voice clips that
// play when a merge creates that tier. Everything goes through one AudioContext so mute and the
// mobile gesture unlock apply uniformly.
import silence from '@/images/silence.mp3';

const STORAGE_KEY = 'mamboka.muted';
const VOICE_GAIN = 0.9;
/** How long after a `resume()` request sounds may still be scheduled while the state is not yet `running`. */
const RESUME_GRACE_MS = 300;

// iPadOS reports itself as a Mac, but a Mac has no touch points.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export class Sfx {
  muted: boolean;
  private ctx: AudioContext | null = null;
  /** Clip bytes, fetched immediately (no gesture needed) and decoded once the context exists. */
  private readonly voiceBytes = new Map<number, Promise<ArrayBuffer>>();
  private readonly voices = new Map<number, AudioBuffer>();
  /** The one voice clip playing right now; any new voice cuts it off rather than overlapping. */
  private playing: AudioBufferSourceNode | null = null;
  private resumeRequestedAt = -Infinity;
  /**
   * iOS plays WebAudio in the "ambient" audio session, which the ringer switch silences. A playing
   * media element moves the page to the "playback" session, so a looping silent clip keeps the
   * game audible with the switch on.
   */
  private keepalive: HTMLAudioElement | null = null;

  /** `voices[tier]` is the URL of the clip to play when that tier is created, if any. */
  constructor(voices: ReadonlyArray<string | undefined> = []) {
    this.muted = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1';
    voices.forEach((url, tier) => {
      if (!url) return;
      this.voiceBytes.set(
        tier,
        fetch(url).then(res => {
          if (!res.ok) throw new Error(`${res.status} ${url}`);
          return res.arrayBuffer();
        }),
      );
    });
  }

  /**
   * Creates/resumes the context. MUST run synchronously inside an activation-triggering event:
   * `pointerup`, `touchend`, `click`, `keydown`, or `pointerdown` from a mouse — a touch
   * `pointerdown` does not grant activation, so resuming there leaves the context suspended.
   * Safe to call repeatedly; also recovers from iOS's `interrupted` state (calls, app switches).
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.decodeVoices(this.ctx);
    }
    if (this.ctx.state !== 'running') {
      this.resumeRequestedAt = performance.now();
      void this.ctx.resume();
    }
    if (IS_IOS) this.keepAlive();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    if (muted) this.stopVoices();
  }

  /** Cuts the voice clip still playing, if any (the long ones outlast a merge). */
  stopVoices(): void {
    this.playing?.stop();
    this.playing = null;
  }

  drop(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(ctx, 'triangle', 520, 300, t, 0.06, 0.12);
  }

  /** Landing thud; heavier for bigger tiers. */
  land(tier: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noise(ctx, t, 0.05 + tier * 0.004, 0.05);
  }

  /** A merge created `tier`: the size-scaled pop, plus the tier's voice clip when it has one. */
  merge(tier: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = 900 * Math.pow(0.86, tier);
    this.tone(ctx, 'sine', base * 1.6, base * 0.7, t, 0.12 + tier * 0.012, 0.22);
    this.tone(ctx, 'square', base * 0.5, base * 0.45, t + 0.02, 0.03, 0.08);
    if (tier >= 5) this.noise(ctx, t, 0.08, 0.05 + tier * 0.008);
    const voice = this.voices.get(tier);
    if (voice) this.voice(ctx, voice, t);
  }

  /** Two Mambos cancelling out: a bright ascending sparkle. */
  cancel(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(ctx, 'sine', f, f, t + i * 0.06, 0.16, 0.2));
  }

  gameOver(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 349, 311, 262].forEach((f, i) => this.tone(ctx, 'triangle', f, f * 0.98, t + i * 0.22, 0.28, 0.18));
  }

  click(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, 'sine', 700, 700, ctx.currentTime, 0.04, 0.1);
  }

  private ready(): AudioContext | null {
    if (this.muted || !this.ctx) return null;
    // `resume()` resolves asynchronously; sounds scheduled meanwhile (e.g. the drop that unlocked
    // the audio) start the moment it does, so only refuse when no resume is pending.
    if (this.ctx.state !== 'running' && performance.now() - this.resumeRequestedAt > RESUME_GRACE_MS) return null;
    return this.ctx;
  }

  /** Starts (or restarts after the page was backgrounded) the silent loop; needs a user gesture. */
  private keepAlive(): void {
    if (!this.keepalive) {
      const audio = new Audio(silence);
      audio.loop = true;
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      this.keepalive = audio;
    }
    if (this.keepalive.paused) void this.keepalive.play().catch(() => undefined);
  }

  private decodeVoices(ctx: AudioContext): void {
    for (const [tier, bytes] of this.voiceBytes) {
      bytes
        .then(buf => ctx.decodeAudioData(buf))
        .then(decoded => this.voices.set(tier, decoded))
        .catch((err: unknown) => console.warn(`Mamboka: voice clip for tier ${tier} unavailable`, err));
    }
  }

  private voice(ctx: AudioContext, buffer: AudioBuffer, at: number): void {
    this.stopVoices();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const amp = ctx.createGain();
    amp.gain.value = VOICE_GAIN;
    src.connect(amp).connect(ctx.destination);
    src.onended = () => {
      if (this.playing === src) this.playing = null;
    };
    this.playing = src;
    src.start(at);
  }

  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    from: number,
    to: number,
    at: number,
    duration: number,
    gain: number,
  ): void {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain, at + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private noise(ctx: AudioContext, at: number, duration: number, gain: number): void {
    const frames = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const amp = ctx.createGain();
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(at);
  }
}
