// External inputs: a microphone (play your real harmonica) and MIDI keyboards.

import { detectPitch, freqToMidi, NoteTracker, rms } from '../audio/pitch';
import { allOptions, type Harmonica } from '../core/instruments';
import { midiToName, keyUsesFlats } from '../core/pitch';
import { holeSoundText } from '../core/htab/serializer';
import type { HoleSound } from '../core/types';
import { getParsed, useApp } from '../state/store';
import { heldPitchIds, press, pressPitch, release, releaseAll } from './livePlayer';
import * as engine from '../audio/engine';

/** The easiest way to play a (possibly fractional) pitch on the harmonica, if any. */
export function soundForPitch(harp: Harmonica, midi: number): { sound: HoleSound; midi: number } | null {
  let best: { sound: HoleSound; midi: number; score: number } | null = null;
  for (const o of allOptions(harp)) {
    const off = Math.abs(o.midi - midi);
    if (off > 0.5) continue;
    const score = off * 4 + o.cost;
    if (!best || score < best.score) best = { sound: o.sound, midi: o.midi, score };
  }
  return best ? { sound: best.sound, midi: best.midi } : null;
}

const harp = () => getParsed(useApp.getState().text).harp;

// ---- Microphone -----------------------------------------------------------------------

export interface MicReading {
  /** Detected pitch (fractional MIDI). */
  midi: number;
  note: string;
  /** Hole on the current harmonica, e.g. "-3'", or null if it isn't on this harp. */
  hole: string | null;
  /** Cents away from that hole's exact pitch (or from the nearest semitone). */
  cents: number;
}

// Collects microphone samples on the audio thread and hands over overlapping
// 2048-sample blocks every 1024 samples. Unlike timers or animation frames, this
// keeps running at full rate when the page is in the background.
const TAP_WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.size = 2048; this.buf = new Float32Array(this.size); this.n = 0; this.hop = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this.buf[this.n++ % this.size] = ch[i];
      this.hop += ch.length;
      if (this.hop >= 1024) {
        this.hop = 0;
        const out = new Float32Array(this.size);
        const start = this.n % this.size;
        out.set(this.buf.subarray(start));
        out.set(this.buf.subarray(0, start), this.size - start);
        this.port.postMessage(out, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('harpforge-tap', Tap);
`;

let mic: { ctx: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; tap: AudioWorkletNode } | null = null;
let lastUiUpdate = 0;
export const MIC_ID = 'mic';

/** A note heard while the app was sounding: counted once the app is quiet, if it's still held. */
let heldBack: number | null = null;

function micNoteOn(note: number) {
  const found = soundForPitch(harp(), note);
  if (found) press(MIC_ID, found.sound, { silent: true });
}

const tracker = new NoteTracker({
  on: (note) => {
    // The app's own sound coming back through the microphone isn't you playing.
    if (engine.appSounding()) heldBack = note;
    else micNoteOn(note);
  },
  move: () => {},
  off: () => {
    heldBack = null;
    release(MIC_ID);
  },
});

function analyse(buf: Float32Array, sampleRate: number) {
  const level = rms(buf);
  const sensitivity = useApp.getState().micSensitivity;
  const gate = 0.004 + (1 - sensitivity) * 0.04;
  let reading: MicReading | null = null;
  if (level > gate) {
    const p = detectPitch(buf, sampleRate);
    if (p && p.clarity > 0.82) {
      const midi = freqToMidi(p.freq);
      if (midi > 40 && midi < 104) {
        const h = harp();
        const found = soundForPitch(h, midi);
        reading = {
          midi,
          note: midiToName(Math.round(midi), keyUsesFlats(getParsed(useApp.getState().text).doc.meta.key ?? h.spec.key)),
          hole: found ? holeSoundText(found.sound) : null,
          cents: Math.round((found ? midi - found.midi : midi - Math.round(midi)) * 100),
        };
      }
    }
  }
  tracker.push(reading ? reading.midi : null);
  if (heldBack !== null && !engine.appSounding()) {
    micNoteOn(heldBack);
    heldBack = null;
  }
  const now = performance.now();
  if (now - lastUiUpdate > 50) {
    lastUiUpdate = now;
    useApp.setState({ mic: { status: 'on', level, reading } });
  }
}

/** Counts starts and stops: a start that was stopped (or overtaken) while it waited gives up. */
let micTicket = 0;

export async function startMic(): Promise<void> {
  if (mic) return;
  const ticket = ++micTicket;
  const current = () => ticket === micTicket;
  useApp.setState({ mic: { status: 'starting', level: 0, reading: null } });
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  // Gives back whatever this start had opened (the browser's recording light goes off).
  const release = () => {
    stream?.getTracks().forEach((t) => t.stop());
    if (ctx && ctx.state !== 'closed') void ctx.close();
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (!current()) return release();
    // A separate context just for listening; it never plays anything.
    ctx = new AudioContext();
    await ctx.resume();
    if (!current()) return release();
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    if (!current()) return release();
    const source = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, 'harpforge-tap', { numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(tap).connect(mute).connect(ctx.destination); // silent: keeps the graph running, no feedback
    const rate = ctx.sampleRate;
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (mic) analyse(e.data, rate);
    };
    mic = { ctx, stream, source, tap };
    useApp.setState({ mic: { status: 'on', level: 0, reading: null } });
  } catch (e) {
    release();
    if (!current()) return;
    const err = e as Error;
    const message =
      err.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in the browser’s address bar, then try again.'
        : err.name === 'NotFoundError'
          ? 'No microphone found.'
          : `Couldn’t start the microphone: ${err.message}`;
    useApp.setState({ mic: { status: 'error', level: 0, reading: null, error: message } });
  }
}

export function stopMic() {
  micTicket++; // a start still waiting (e.g. for the permission prompt) gives up
  if (!mic) {
    useApp.setState({ mic: { status: 'off', level: 0, reading: null } });
    return;
  }
  const { ctx, stream, source, tap } = mic;
  mic = null;
  tap.port.onmessage = null;
  source.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  void ctx.close();
  tracker.reset();
  heldBack = null;
  useApp.setState({ mic: { status: 'off', level: 0, reading: null } });
}

// ---- MIDI keyboards ----------------------------------------------------------------------

let midiAccess: MIDIAccess | null = null;

function onMidiMessage(e: MIDIMessageEvent) {
  const data = e.data;
  if (!data || data.length < 3) return;
  const type = data[0] & 0xf0;
  const note = data[1];
  // Per keyboard, so unplugging one releases only its notes.
  const id = `midi:${(e.target as MIDIInput | null)?.id ?? ''}:${note}`;
  if (type === 0x90 && data[2] > 0) {
    const found = soundForPitch(harp(), note);
    if (found) press(id, found.sound);
    else {
      // It still sounds, and the editor can write it as a note name.
      pressPitch(id, note);
      useApp.setState({ midi: { ...useApp.getState().midi, miss: `${midiToName(note)} isn’t on this harmonica` } });
    }
  } else if (type === 0x80 || (type === 0x90 && data[2] === 0)) {
    release(id);
  }
}

function refreshMidiDevices() {
  if (!midiAccess) return;
  const devices: string[] = [];
  const connected = new Set<string>();
  midiAccess.inputs.forEach((input) => {
    input.onmidimessage = onMidiMessage;
    devices.push(input.name || 'MIDI input');
    if (input.state !== 'disconnected') connected.add(input.id);
  });
  // A keyboard unplugged mid-note never sends the note-off: release what it was holding.
  const held = [...Object.keys(useApp.getState().held), ...heldPitchIds()];
  for (const id of held) {
    const m = /^midi:(.*):\d+$/.exec(id);
    if (m && !connected.has(m[1])) release(id);
  }
  useApp.setState({ midi: { status: 'on', devices } });
}

export async function startMidi(): Promise<void> {
  if (!('requestMIDIAccess' in navigator)) {
    useApp.setState({ midi: { status: 'unsupported', devices: [] } });
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = refreshMidiDevices;
    refreshMidiDevices();
  } catch {
    useApp.setState({ midi: { status: 'error', devices: [] } });
  }
}

export function stopMidi() {
  // Notes held on the keyboard would otherwise keep sounding.
  releaseAll('midi:');
  midiAccess?.inputs.forEach((input) => (input.onmidimessage = null));
  if (midiAccess) midiAccess.onstatechange = null;
  midiAccess = null;
  useApp.setState({ midi: { status: 'off', devices: [] } });
}
