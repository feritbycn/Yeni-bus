import type { Settings } from './types';

export interface AudioFrame {
  engineOn: boolean;
  rpm: number;
  throttle: number;
  speed: number;
  brake: number;
  slip: number;
  rain: number;
  offRoad: boolean;
  electric: boolean;
  atTerminal: boolean;
  engineVolumeScale?: number;
}

/**
 * All sound is synthesised with the Web Audio API (oscillators + filtered noise), so the project
 * ships NO audio files and has no licensing risk. Channels (gain buses): engine, brake, signal,
 * horn, doors, road (tyre + road), rain, wind, terminal ambience and UI. See docs/KNOWN_LIMITATIONS.md:
 * synthesised sounds are prototype quality; replace with recorded, licensed samples for release.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private vehicleBus!: GainNode;
  private ambientBus!: GainNode;
  private uiBus!: GainNode;
  private ch: Record<string, GainNode> = {};
  private noise!: AudioBuffer;
  private engine: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; lp: BiquadFilterNode; gain: GainNode; noiseGain: GainNode } | null = null;
  private road: { src: AudioBufferSourceNode; lp: BiquadFilterNode; gain: GainNode } | null = null;
  private squeal: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; lp: BiquadFilterNode; gain: GainNode } | null = null;
  private rain: { src: AudioBufferSourceNode; hp: BiquadFilterNode; gain: GainNode } | null = null;
  private amb: { src: AudioBufferSourceNode; bp: BiquadFilterNode; gain: GainNode } | null = null;
  private hornNodes: { o1: OscillatorNode; o2: OscillatorNode } | null = null;
  private brakeHissGain = 0;
  private settings: Settings | null = null;
  private started = false;

  get ready(): boolean {
    return this.started && !!this.ctx;
  }

  /** Must be called from a user gesture (click / key / touch). Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    this.started = true;
    if (this.settings) this.applySettings(this.settings);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    if (this.started) void this.ctx?.resume();
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.97 * b0 + 0.03 * white; // slightly warm noise
      d[i] = white * 0.6 + b0 * 3;
    }
    return buf;
  }

  private loop(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }

  private channel(name: string, parent: GainNode): GainNode {
    const g = this.ctx!.createGain();
    g.connect(parent);
    this.ch[name] = g;
    return g;
  }

  private build(): void {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.vehicleBus = ctx.createGain();
    this.ambientBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.vehicleBus.connect(this.master);
    this.ambientBus.connect(this.master);
    this.uiBus.connect(this.master);
    this.noise = this.makeNoise(ctx);

    const chEngine = this.channel('engine', this.vehicleBus);
    const chBrake = this.channel('brake', this.vehicleBus);
    this.channel('signal', this.vehicleBus);
    this.channel('horn', this.vehicleBus);
    this.channel('doors', this.vehicleBus);
    const chRoad = this.channel('road', this.vehicleBus);
    const chRain = this.channel('rain', this.ambientBus);
    const chWind = this.channel('wind', this.ambientBus);
    const chTerm = this.channel('terminal', this.ambientBus);
    this.channel('ui', this.uiBus);

    // engine
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const o3 = ctx.createOscillator();
    o3.type = 'sine';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const eg = ctx.createGain();
    eg.gain.value = 0;
    const g1 = ctx.createGain();
    g1.gain.value = 0.35;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    const g3 = ctx.createGain();
    g3.gain.value = 0.5;
    o1.connect(g1).connect(lp);
    o2.connect(g2).connect(lp);
    o3.connect(g3).connect(lp);
    lp.connect(eg).connect(chEngine);
    const nSrc = this.loop(ctx, this.noise);
    const nLp = ctx.createBiquadFilter();
    nLp.type = 'lowpass';
    nLp.frequency.value = 700;
    const nGain = ctx.createGain();
    nGain.gain.value = 0;
    nSrc.connect(nLp).connect(nGain).connect(chEngine);
    o1.start();
    o2.start();
    o3.start();
    this.engine = { o1, o2, o3, lp, gain: eg, noiseGain: nGain };

    // road / tyre rumble
    const rs = this.loop(ctx, this.noise);
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 500;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    rs.connect(rlp).connect(rg).connect(chRoad);
    this.road = { src: rs, lp: rlp, gain: rg };

    // tyre squeal
    const ss = this.loop(ctx, this.noise);
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 1800;
    sbp.Q.value = 6;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    ss.connect(sbp).connect(sg).connect(chBrake);
    this.squeal = { src: ss, bp: sbp, gain: sg };

    // wind
    const ws = this.loop(ctx, this.noise);
    const wlp = ctx.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 900;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    ws.connect(wlp).connect(wg).connect(chWind);
    this.wind = { src: ws, lp: wlp, gain: wg };

    // rain
    const rn = this.loop(ctx, this.noise);
    const rhp = ctx.createBiquadFilter();
    rhp.type = 'highpass';
    rhp.frequency.value = 1500;
    const rng = ctx.createGain();
    rng.gain.value = 0;
    rn.connect(rhp).connect(rng).connect(chRain);
    this.rain = { src: rn, hp: rhp, gain: rng };

    // terminal ambience (murmur)
    const as = this.loop(ctx, this.noise);
    const abp = ctx.createBiquadFilter();
    abp.type = 'bandpass';
    abp.frequency.value = 420;
    abp.Q.value = 0.8;
    const ag = ctx.createGain();
    ag.gain.value = 0;
    as.connect(abp).connect(ag).connect(chTerm);
    this.amb = { src: as, bp: abp, gain: ag };
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = s.muted ? 0 : s.volumes.master;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.vehicleBus.gain.setTargetAtTime(s.volumes.vehicle, t, 0.05);
    this.ambientBus.gain.setTargetAtTime(s.volumes.ambient, t, 0.05);
    this.uiBus.gain.setTargetAtTime(s.volumes.ui, t, 0.05);
  }

  /** Per-frame update of the continuous sounds. */
  update(f: AudioFrame): void {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;
    const e = this.engine!;
    const scale = f.engineVolumeScale ?? 1;
    if (f.engineOn) {
      if (f.electric) {
        const hz = 180 + f.rpm * 0.08;
        e.o1.frequency.setTargetAtTime(hz, t, 0.05);
        e.o2.frequency.setTargetAtTime(hz * 2.01, t, 0.05);
        e.o3.frequency.setTargetAtTime(hz * 0.5, t, 0.05);
        e.lp.frequency.setTargetAtTime(1800 + f.throttle * 1500, t, 0.08);
        e.gain.gain.setTargetAtTime((0.05 + f.throttle * 0.1 + Math.min(0.1, f.speed * 0.005)) * scale, t, 0.1);
        e.noiseGain.gain.setTargetAtTime(0.01 * scale, t, 0.1);
      } else {
        const hz = Math.max(20, (f.rpm / 60) * 3);
        e.o1.frequency.setTargetAtTime(hz, t, 0.04);
        e.o2.frequency.setTargetAtTime(hz * 2.0, t, 0.04);
        e.o3.frequency.setTargetAtTime(hz * 0.5, t, 0.04);
        e.lp.frequency.setTargetAtTime(260 + f.throttle * 700 + f.rpm * 0.12, t, 0.06);
        e.gain.gain.setTargetAtTime((0.2 + f.throttle * 0.28) * scale, t, 0.08);
        e.noiseGain.gain.setTargetAtTime((0.015 + f.throttle * 0.05) * scale, t, 0.08);
      }
    } else {
      e.gain.gain.setTargetAtTime(0, t, 0.08);
      e.noiseGain.gain.setTargetAtTime(0, t, 0.08);
    }
    const sp = Math.abs(f.speed);
    this.road!.gain.gain.setTargetAtTime(Math.min(0.5, sp * 0.012) * (f.offRoad ? 2 : 1), t, 0.1);
    this.road!.lp.frequency.setTargetAtTime(300 + sp * 25 + (f.offRoad ? 600 : 0), t, 0.1);
    this.wind!.gain.gain.setTargetAtTime(Math.min(0.5, sp * sp * 0.0006), t, 0.15);
    this.wind!.lp.frequency.setTargetAtTime(500 + sp * 40, t, 0.15);
    this.rain!.gain.gain.setTargetAtTime(f.rain * 0.22, t, 0.4);
    const sq = Math.max(f.slip > 0.15 ? Math.min(0.4, f.slip * 0.4) : 0, f.brake > 0.9 && sp > 14 ? 0.12 : 0);
    this.squeal!.gain.gain.setTargetAtTime(sq, t, 0.05);
    this.squeal!.bp.frequency.setTargetAtTime(1400 + sp * 25, t, 0.1);
    this.amb!.gain.gain.setTargetAtTime(f.atTerminal ? 0.12 : 0, t, 0.5);
    // air-brake hiss when stopping
    if (f.brake > 0.5 && sp < 0.5 && this.brakeHissGain < 0.5) {
      this.brakeHissGain = 1;
      this.hiss();
    }
    if (f.brake < 0.2 || sp > 2) this.brakeHissGain = 0;
  }

  // ---------- one-shot sounds ----------

  private burst(channel: string, opts: { dur: number; freq: number; q?: number; type?: BiquadFilterType; vol: number; attack?: number }): void {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(opts.vol, t + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(this.ch[channel]);
    src.start(t);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(channel: string, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ch[channel]);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hiss(): void {
    this.burst('brake', { dur: 0.9, freq: 5000, q: 0.5, type: 'highpass', vol: 0.18 });
  }

  tick(high: boolean): void {
    this.tone('signal', high ? 1500 : 1100, 0.04, 0.12, 'square');
  }

  doorSound(open: boolean): void {
    this.burst('doors', { dur: 0.7, freq: open ? 3500 : 2500, q: 0.4, type: 'highpass', vol: 0.15 });
    this.tone('doors', open ? 90 : 70, 0.25, 0.2, 'sine', 45);
  }

  engineStart(): void {
    this.tone('engine', 55, 0.8, 0.25, 'sawtooth', 110);
    this.burst('engine', { dur: 0.6, freq: 300, q: 1, type: 'lowpass', vol: 0.2 });
  }

  crash(intensity: number): void {
    const v = Math.min(1, 0.25 + intensity * 0.08);
    this.burst('brake', { dur: 0.6, freq: 700, q: 0.7, type: 'lowpass', vol: 0.5 * v });
    this.tone('brake', 120, 0.4, 0.4 * v, 'square', 40);
  }

  hornOn(on: boolean): void {
    if (!this.ctx || !this.started) return;
    if (on && !this.hornNodes) {
      const ctx = this.ctx;
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = 'square';
      o2.type = 'square';
      o1.frequency.value = 392;
      o2.frequency.value = 494;
      const g = ctx.createGain();
      g.gain.value = 0.1;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      o1.connect(g);
      o2.connect(g);
      g.connect(lp).connect(this.ch.horn);
      o1.start();
      o2.start();
      this.hornNodes = { o1, o2 };
    } else if (!on && this.hornNodes) {
      this.hornNodes.o1.stop();
      this.hornNodes.o2.stop();
      this.hornNodes = null;
    }
  }

  ui(kind: 'click' | 'ok' | 'error' | 'coin' = 'click'): void {
    if (!this.ctx || !this.started) return;
    switch (kind) {
      case 'click':
        this.tone('ui', 660, 0.06, 0.12, 'triangle');
        break;
      case 'ok':
        this.tone('ui', 520, 0.1, 0.14, 'triangle');
        setTimeout(() => this.tone('ui', 780, 0.14, 0.14, 'triangle'), 90);
        break;
      case 'error':
        this.tone('ui', 220, 0.2, 0.16, 'sawtooth', 150);
        break;
      case 'coin':
        this.tone('ui', 988, 0.08, 0.14, 'square');
        setTimeout(() => this.tone('ui', 1319, 0.2, 0.14, 'square'), 70);
        break;
    }
  }

  vibrate(ms: number): void {
    if (this.settings?.vibration && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* ignore */
      }
    }
  }
}
