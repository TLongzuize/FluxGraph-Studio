/* ───────────────────────────────────────────────
   FluxGraph — Audio Analysis Module
   Web Audio API integration for reactive visual effects.
   Provides frequency spectrum, waveform, and normalized
   audio energy metrics (bass, mid, treble, volume).
   ─────────────────────────────────────────────── */

import type { AudioMetrics } from '../../types';

// Track elements that already have a MediaElementAudioSourceNode created
// to prevent InvalidStateError: HTMLMediaElement already connected
interface ConnectedSource {
  source: MediaElementAudioSourceNode;
  context: AudioContext;
  leases: number;
}

// A media element may only have one MediaElementAudioSourceNode for its lifetime.
// Keep its creating context alongside it so a remounted analyzer never tries to
// connect a node from one AudioContext into another.
const connectedSourceMap = new WeakMap<HTMLMediaElement, ConnectedSource>();

export class AudioAnalyzer {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private connectedMediaElement: HTMLMediaElement | null = null;
  private connectionRecord: ConnectedSource | null = null;

  // Reusable buffers to avoid per-frame GC allocations
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;

  // Cached smoothed metrics
  private currentMetrics: AudioMetrics = {
    volume: 0,
    bass: 0,
    mid: 0,
    treble: 0,
  };

  /**
   * Connect to an HTMLVideoElement's audio track.
   * Safe to call multiple times or with different video elements.
   */
  connect(media: HTMLMediaElement) {
    if (this.connectedMediaElement === media && this.audioCtx && this.analyserNode) {
      this.resume();
      return;
    }

    // Switching media elements must release this analyzer's previous edge.
    // A source record may still be shared with another live analyzer.
    this.releaseConnection();

    try {
      const existing = connectedSourceMap.get(media);

      // Reuse the context that owns an existing source node. The Web Audio API
      // does not allow that node to be moved to a newly-created context.
      if (existing && existing.context.state !== 'closed') {
        this.audioCtx = existing.context;
      } else if (!this.audioCtx || this.audioCtx.state === 'closed') {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) {
          console.log('[AudioAnalyzer] Web Audio API not available');
          return;
        }
        this.audioCtx = new AudioContextClass();
      }

      // Create analyser node with temporal smoothing
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.75;

      const binCount = this.analyserNode.frequencyBinCount;
      this.freqData = new Uint8Array(new ArrayBuffer(binCount));
      this.timeData = new Uint8Array(new ArrayBuffer(this.analyserNode.fftSize));

      // Reuse the one media source attached to this element, or create it once.
      let record = connectedSourceMap.get(media);
      if (!record) {
        try {
          const source = this.audioCtx.createMediaElementSource(media);
          record = { source, context: this.audioCtx, leases: 0 };
          connectedSourceMap.set(media, record);
        } catch (e) {
          console.warn('[AudioAnalyzer] Could not create MediaElementSource - media may already be connected:', e);
          this.connectedMediaElement = media;
          this.resume();
          return;
        }
      }

      this.connectionRecord = record;
      record.leases++;
      this.sourceNode = record.source;
      this.connectedMediaElement = media;

      // Connect: Video -> Analyser -> Speakers (destination)
      try {
        this.sourceNode.connect(this.analyserNode);
        this.analyserNode.connect(this.audioCtx.destination);
      } catch (e) {
        // Connection might fail if already connected elsewhere
        console.warn('[AudioAnalyzer] Could not connect audio nodes:', e);
      }

      this.resume();
    } catch (e) {
      // Audio might fail in certain environments or if blocked by browser policy
      console.warn('[AudioAnalyzer] Could not initialize audio context:', e);
    }
  }

  /**
   * Resume audio context if suspended by browser autoplay policy.
   */
  async resume() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        // Silently catch until user interacts
      }
    }
  }

  /**
   * Get raw frequency data (0–255 per bin). Reuses internal buffer.
   */
  getFrequencyData(): Uint8Array | null {
    if (!this.analyserNode || !this.freqData) return null;
    this.analyserNode.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  /**
   * Get raw time-domain waveform data (0–255, 128 = zero crossing).
   */
  getWaveformData(): Uint8Array | null {
    if (!this.analyserNode || !this.timeData) return null;
    this.analyserNode.getByteTimeDomainData(this.timeData);
    return this.timeData;
  }

  /**
   * Compute normalized audio metrics (volume, bass, mid, treble) in [0, 1].
   * Uses zero allocations in the hot loop.
   */
  getAudioMetrics(): AudioMetrics {
    if (!this.analyserNode || !this.freqData || !this.timeData) {
      return this.currentMetrics;
    }

    this.analyserNode.getByteFrequencyData(this.freqData);
    this.analyserNode.getByteTimeDomainData(this.timeData);

    const binCount = this.freqData.length;
    if (binCount === 0 || this.timeData.length === 0) return this.currentMetrics;

    // 1. Calculate volume (RMS from time domain)
    let sumSquares = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const normalized = (this.timeData[i] - 128) / 128; // -1 to +1
      sumSquares += normalized * normalized;
    }
    const rms = Math.min(1, Math.sqrt(sumSquares / this.timeData.length) * 1.4);

    // 2. Frequency bands
    // With fftSize 256 and 44.1/48kHz sample rate, each bin is ~170-190Hz.
    // Bass: bins 1 to 3 (~40Hz - 600Hz)
    // Mid: bins 4 to 15 (~600Hz - 3000Hz)
    // Treble: bins 16 to 48 (~3000Hz - 9000Hz)
    let bassSum = 0;
    const bassEnd = Math.min(4, binCount);
    for (let i = 1; i < bassEnd; i++) {
      bassSum += this.freqData[i];
    }
    const bass = bassEnd > 1 ? bassSum / ((bassEnd - 1) * 255) : 0;

    let midSum = 0;
    const midEnd = Math.min(16, binCount);
    for (let i = bassEnd; i < midEnd; i++) {
      midSum += this.freqData[i];
    }
    const mid = midEnd > bassEnd ? midSum / ((midEnd - bassEnd) * 255) : 0;

    let trebleSum = 0;
    const trebleEnd = Math.min(48, binCount);
    for (let i = midEnd; i < trebleEnd; i++) {
      trebleSum += this.freqData[i];
    }
    const treble = trebleEnd > midEnd ? trebleSum / ((trebleEnd - midEnd) * 255) : 0;

    this.currentMetrics.volume = rms;
    this.currentMetrics.bass = bass;
    this.currentMetrics.mid = mid;
    this.currentMetrics.treble = treble;

    return this.currentMetrics;
  }

  /**
   * Check if audio analyzer is currently active and receiving data.
   */
  isActive(): boolean {
    return Boolean(
      this.audioCtx &&
      this.audioCtx.state === 'running' &&
      this.currentMetrics.volume > 0.01,
    );
  }

  /**
   * Disconnect nodes and release resources.
   */
  dispose() {
    this.releaseConnection();
    this.freqData = null;
    this.timeData = null;
    this.currentMetrics = { volume: 0, bass: 0, mid: 0, treble: 0 };
  }

  private releaseConnection() {
    try {
      if (this.sourceNode && this.analyserNode) this.sourceNode.disconnect(this.analyserNode);
      this.analyserNode?.disconnect();
    } catch {
      // Disconnect can throw if the browser already discarded an audio node.
    }

    const record = this.connectionRecord;
    if (record) {
      record.leases = Math.max(0, record.leases - 1);
      if (record.leases === 0 && record.context.state === 'running') {
        // Suspension releases real-time processing while keeping the element's
        // one-time MediaElementAudioSourceNode reusable after React remounts.
        void record.context.suspend().catch(() => undefined);
      }
    }

    this.sourceNode = null;
    this.analyserNode = null;
    this.connectedMediaElement = null;
    this.connectionRecord = null;
    this.audioCtx = null;
  }
}
