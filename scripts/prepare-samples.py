"""
Prepares harmonica samples for the web player.

Source: Versilian Community Sample Library (VCSL), "Harmonica-Hohner-Special20-C",
Sustains/Normal — CC0 1.0 (public domain). https://github.com/sgossner/VCSL
VCSL labels are one octave low (their "C3" is middle C), which we correct.

For each note: trim leading silence, find a seamless loop region (period-aligned,
best-correlated, with a baked crossfade), normalise loudness, resample to 22.05 kHz
mono 16-bit, and write public/samples/harmonica/<note>.wav plus manifest.json.

Usage: python scripts/prepare-samples.py <folder with N_<label>.wav files>
"""

import json
import os
import sys
import wave

import numpy as np

OUT_RATE = 22050
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'samples', 'harmonica')
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
LABEL_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def load(path):
    w = wave.open(path)
    n, sr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
    raw = w.readframes(n)
    w.close()
    if sw == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        x = b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16)
        x = np.where(x >= 1 << 23, x - (1 << 24), x).astype(np.float64) / (1 << 23)
    elif sw == 2:
        x = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768
    else:
        raise ValueError(f'unsupported sample width {sw}')
    return x.reshape(-1, ch).mean(axis=1), sr


def resample(x, sr_in, sr_out):
    """FFT-based band-limited resampling."""
    n_out = int(round(len(x) * sr_out / sr_in))
    spec = np.fft.rfft(x)
    keep = n_out // 2 + 1
    spec = spec[:keep] if len(spec) >= keep else np.pad(spec, (0, keep - len(spec)))
    return np.fft.irfft(spec, n_out) * (n_out / len(x))


def measured_midi(x, sr, expected):
    """Fine pitch near the expected note (autocorrelation restricted to ±1 semitone)."""
    seg = x[int(sr * 1.0):int(sr * 1.0) + 8192]
    seg = seg - seg.mean()
    ac = np.correlate(seg, seg, 'full')[len(seg) - 1:]
    f_exp = 440 * 2 ** ((expected - 69) / 12)
    lo, hi = int(sr / (f_exp * 2 ** (1 / 12))), int(sr / (f_exp / 2 ** (1 / 12))) + 1
    k = lo + int(np.argmax(ac[lo:hi]))
    a, b, c = ac[k - 1], ac[k], ac[k + 1]
    k_ref = k + 0.5 * (a - c) / (a - 2 * b + c)
    return 69 + 12 * np.log2(sr / k_ref / 440)


def process(path, label):
    x, sr = load(path)
    letter, octave = label[0], int(label[1:])
    midi = (octave + 2) * 12 + LABEL_PC[letter]  # label + one octave
    fine = measured_midi(x, sr, midi)

    # Trim leading silence (keep 10 ms before the onset).
    env = np.abs(x)
    onset = int(np.argmax(env > env.max() * 0.05))
    x = x[max(0, onset - int(0.01 * sr)):]

    x = resample(x, sr, OUT_RATE)
    sr = OUT_RATE

    # Loop region: start ~0.9 s in, length ~1.6 s, snapped to whole periods and the
    # best waveform match, with a 40 ms baked crossfade.
    # Search every sample position in the window for the best normalised match.
    start = int(0.9 * sr)
    win = 1024
    ref = x[start:start + win]
    lo = start + int(1.1 * sr)
    hi = min(len(x) - int(0.3 * sr) - win, start + int(2.0 * sr))
    region = x[lo:hi + win]
    dots = np.correlate(region, ref, 'valid')
    sq = np.concatenate([[0.0], np.cumsum(region ** 2)])
    norms = np.sqrt(sq[win:] - sq[:-win]) * np.linalg.norm(ref) + 1e-12
    scores = dots / norms[: len(dots)]
    k = int(np.argmax(scores))
    end, best_score = lo + k, float(scores[k])
    fade = int(0.04 * sr)
    t = np.linspace(0, 1, fade)
    x = x.copy()
    x[end - fade:end] = x[end - fade:end] * (1 - t) + x[start - fade:start] * t

    # Keep a short tail after the loop for the release, then fade it out.
    x = x[:end + int(0.25 * sr)]
    x[end:] *= np.linspace(1, 0, len(x) - end)

    # Loudness: match RMS of the sustain.
    rms = np.sqrt(np.mean(x[start:end] ** 2))
    x *= 0.18 / rms
    x = np.clip(x, -0.99, 0.99)

    name = f'{NAMES[midi % 12]}{midi // 12 - 1}'.replace('#', 's')
    out = os.path.join(OUT_DIR, f'{name}.wav')
    w = wave.open(out, 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes((x * 32767).astype('<i2').tobytes())
    w.close()
    return {
        'note': name,
        'midi': midi,
        'tuneCents': round((fine - midi) * 100, 1),
        'file': f'{name}.wav',
        'loopStart': round(start / sr, 5),
        'loopEnd': round(end / sr, 5),
        'loopMatch': round(best_score, 3),
        'duration': round(len(x) / sr, 3),
    }


def main():
    src = sys.argv[1]
    os.makedirs(OUT_DIR, exist_ok=True)
    notes = []
    for f in sorted(os.listdir(src)):
        if f.startswith('N_') and f.endswith('.wav'):
            info = process(os.path.join(src, f), f[2:-4])
            notes.append(info)
            print(info)
    notes.sort(key=lambda n: n['midi'])
    manifest = {
        'name': 'Hohner Special 20 (C)',
        'source': 'Versilian Community Sample Library (VCSL) — https://github.com/sgossner/VCSL',
        'license': 'CC0 1.0 Universal (public domain)',
        'sampleRate': OUT_RATE,
        'notes': notes,
    }
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2)


if __name__ == '__main__':
    main()
