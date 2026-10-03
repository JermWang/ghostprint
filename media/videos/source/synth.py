# Procedural score for the explainers: a 120 BPM music bed plus SFX placed from the page's cues.
# python3 synth.py cues.json out.wav   — everything is synthesized here; no samples.
import json, sys, numpy as np
from scipy.signal import butter, lfilter

SR = 48000
rng = np.random.default_rng(7)
cues = json.load(open(sys.argv[1])); DUR = cues["dur"]; N = int((DUR + 1.2) * SR)
L = np.zeros(N); R = np.zeros(N)
def env(n, a, d):  # attack (s), exponential decay time constant (s)
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / d)
def put(sig, t, gain=1., pan=0.):
    i = int(t * SR); n = min(len(sig), N - i)
    if n <= 0 or i < 0: return
    L[i:i + n] += sig[:n] * gain * np.sqrt((1 - pan) / 2) * 1.414
    R[i:i + n] += sig[:n] * gain * np.sqrt((1 + pan) / 2) * 1.414
def lp(x, f, o=2): b, a = butter(o, f / (SR / 2)); return lfilter(b, a, x)
def hp(x, f, o=2): b, a = butter(o, f / (SR / 2), "high"); return lfilter(b, a, x)
def bp(x, f0, f1): b, a = butter(2, [f0 / (SR / 2), f1 / (SR / 2)], "band"); return lfilter(b, a, x)
def hz(m): return 440 * 2 ** ((m - 69) / 12)
def tone(f, dur, wave="sine"):
    t = np.arange(int(dur * SR)) / SR; ph = 2 * np.pi * f * t if np.isscalar(f) else 2 * np.pi * np.cumsum(f) / SR
    if wave == "sine": return np.sin(ph)
    if wave == "tri": return 2 / np.pi * np.arcsin(np.sin(ph))
    if wave == "saw": return 2 * ((ph / (2 * np.pi)) % 1) - 1
    if wave == "sq": return np.sign(np.sin(ph)) * .6
def sweep(f0, f1, dur): n = int(dur * SR); return f0 * (f1 / f0) ** (np.arange(n) / n)

# ---------- music bed ----------
BEAT = .5; BAR = 4 * BEAT
CH = [[57, 60, 64], [53, 57, 60], [48, 55, 60, 64], [55, 59, 62]]  # Am F C G
end_t = DUR - 1.4  # the bed resolves into the final card
duck = np.ones(N)
def kick(t):
    n = int(.32 * SR); f = 48 + 90 * np.exp(-np.arange(n) / SR / .03)
    s = tone(f, .32) * env(n, .001, .12) + hp(rng.standard_normal(n), 2000) * env(n, .0005, .004) * .3
    put(s, t, .55)
    i = int(t * SR); m = min(int(.25 * SR), N - i)
    if m > 0: duck[i:i + m] = np.minimum(duck[i:i + m], 1 - .45 * np.exp(-np.arange(m) / SR / .09))
def hat(t, g, pan):
    n = int(.06 * SR); put(hp(rng.standard_normal(n), 7500) * env(n, .0005, .012), t, g, pan)
def pluck(m, t, g, pan, dur=.35):
    n = int(dur * SR); f = hz(m)
    s = (tone(f, dur, "saw") * .5 + tone(f * 1.005, dur, "sq") * .5) * env(n, .002, .09)
    s = lp(s, 2600)
    put(s, t, g, pan); put(s, t + .1875 * 2, g * .32, -pan)  # dotted-8th echo
def pad(ms, t, dur, g):
    n = int(dur * SR); s = np.zeros(n)
    for m in ms:
        for det in (-.12, .11):
            s += tone(hz(m + 12) * 2 ** (det / 12), dur, "saw")
    s = lp(s, 1100) * np.minimum(1, np.arange(n) / SR / .5) * np.minimum(1, (n - np.arange(n)) / SR / .4)
    put(s / len(ms), t, g)
bed = []
t = 0.; bar = 0
while t < end_t - .01:
    ch = CH[bar % 4]
    pad(ch, t, min(BAR, end_t - t) + .3, .05)
    for k in range(4):
        b = t + k * BEAT
        if b >= end_t: break
        if bar > 0 or k >= 2: kick(b) if k % 2 == 0 else None
        if t > 0: hat(b + BEAT / 2, .09, .3)
        hat(b, .035, -.3)
        # bass on eighths
        for e in range(2):
            bt = b + e * BEAT / 2
            if bt >= end_t: break
            n = int(.22 * SR); s = lp(tone(hz(ch[0] - 24), .22, "tri") + .3 * tone(hz(ch[0] - 12), .22, "saw"), 600) * env(n, .004, .12)
            put(s, bt, .2 if e == 0 else .13)
        # arp on sixteenths
        arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 24]
        for s16 in range(4):
            at = b + s16 * BEAT / 4
            if at >= end_t: break
            pluck(arp[(k * 4 + s16) % 4], at, .055, (-.4, .4)[s16 % 2])
    t += BAR; bar += 1
# final chord rings out under the end card
pad([57, 60, 64, 69], end_t, 1.9, .08); kick(end_t)
n = int(1.6 * SR); put(lp(tone(hz(33), 1.6, "tri"), 300) * env(n, .005, .5), end_t, .3)
music_L, music_R = L * duck, R * duck
L[:] = 0; R[:] = 0

# ---------- sfx ----------
PENTA = [69, 72, 74, 76, 79, 81, 84]
def whoosh(t):
    n = int(.55 * SR); x = rng.standard_normal(n); out = np.zeros(n); f = sweep(300, 5000, .55)
    # crossfade a bank of bandpasses to fake a sweep
    bands = [(200, 600), (500, 1400), (1200, 3000), (2600, 7000)]
    pos = np.linspace(0, len(bands) - 1, n)
    for i, (a, b) in enumerate(bands): out += bp(x, a, b) * np.clip(1 - abs(pos - i), 0, 1)
    shape = np.sin(np.pi * np.arange(n) / n) ** 2
    put(out * shape, t, .22, 0); put(np.roll(out, 600) * shape, t, .12, .6)
def drop(t, k):
    n = int(.08 * SR); f = (900 - k * 90) * np.exp(-np.arange(n) / SR / .03) + 220
    put(tone(f, .08) * env(n, .001, .018) + hp(rng.standard_normal(n), 3000) * env(n, .0003, .003) * .4, t, .16, (k - 1.5) * .25)
def blip(t, k):
    n = int(.14 * SR); f = hz(PENTA[k % len(PENTA)] + 12)
    s = tone(f, .14) + .3 * tone(f * 2, .14)
    put(s * env(n, .001, .045), t, .085, (-.3, .3)[k % 2])
def thud(t, k):
    n = int(.22 * SR); f = (130 + k * 12) * np.exp(-np.arange(n) / SR / .05) + 55 + k * 6
    put(tone(f, .22) * env(n, .001, .07) + lp(rng.standard_normal(n), 900) * env(n, .001, .015) * .5, t, .34)
def bell(m, t, g, dur=1.6, pan=0):
    n = int(dur * SR); f = hz(m); s = np.zeros(n)
    for ratio, amp, d in ((1, 1, .9), (2.76, .45, .35), (5.4, .22, .15), (8.93, .1, .06)):
        s += amp * tone(f * ratio, dur) * env(n, .002, d)
    put(s, t, g, pan)
def sparkle(t):
    for i in range(9): bell(PENTA[int(rng.integers(len(PENTA)))] + 12, t + i * .055 + rng.random() * .02, .035, .5, rng.uniform(-.6, .6))
def chime(t): bell(81, t, .14); bell(88, t + .07, .09, 1.4, .3)
def finale(t):
    for i, m in enumerate((69, 76, 81, 88)): bell(m, t + i * .045, .12 - i * .015, 2.2, (-.3, .3)[i % 2])
def migrate(t):
    n = int(.6 * SR); s = lp(tone(sweep(180, 900, .6), .6, "saw"), 1800) * np.sin(np.pi * np.arange(n) / n)
    put(s, t - .55, .12); bell(84, t, .12)
for c in cues["cues"]:
    {"whoosh": lambda: whoosh(c["t"]), "drop": lambda: drop(c["t"], c["x"]), "blip": lambda: blip(c["t"], c["x"]),
     "thud": lambda: thud(c["t"], c["x"]), "sparkle": lambda: sparkle(c["t"]), "chime": lambda: chime(c["t"]),
     "finale": lambda: finale(c["t"]), "migrate": lambda: migrate(c["t"])}[c["type"]]()
mix = np.stack([music_L + L, music_R + R], 1)
# simple room: a few early reflections
for d, g in ((.023, .18), (.041, .12), (.067, .08)):
    k = int(d * SR); mix[k:, 0] += mix[:-k, 1] * g; mix[k:, 1] += mix[:-k, 0] * g
mix = mix[: int(DUR * SR)]
fade = int(.5 * SR); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix = np.tanh(mix * 1.2) / 1.2
mix /= np.abs(mix).max() / .89
import wave
w = wave.open(sys.argv[2], "wb"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((mix * 32767).astype("<i2").tobytes()); w.close()
