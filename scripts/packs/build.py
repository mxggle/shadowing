#!/usr/bin/env python3
"""Builds a 素材库 pack from its script (scripts/packs/<id>.json) into site/packs/.

    GEMINI_API_KEY=… python3 -I scripts/packs/build.py tokyo-daily
    OPENAI_API_KEY=… python3 -I scripts/packs/build.py tokyo-daily --engine openai
    python3 -I scripts/packs/build.py tokyo-daily --engine say --out <scratch>   # pipeline test only

Every sentence is spoken on its own (one voice per speaker), its silence trimmed
and its loudness evened out, then the sentences are laid end to end with short
pauses: the subtitle times are exact, no alignment needed. Clips are cached by
engine, voice and text, so a rebuild only asks for what changed (--redo t:l
asks again for line l of track t, both counted from 1).

Writes <out>/<id>/<version>/NN.mp3 and pack.json, and the pack's entry in
<out>/manifest.json (sizes and SHA-256 included). --check transcribes every
clip with whisper-cli and lists the lines whose words differ from the script.

macOS `say` voices may not be redistributed, so --engine say refuses to write
into site/.
"""

import argparse
import array
import base64
import difflib
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RATE = 24000  # Hz, 16-bit mono: what both TTS services return
LEAD, TAIL = 0.5, 0.8  # seconds of silence at the start and end of a track
SAME_SPEAKER_GAP, TURN_GAP = 0.4, 0.75
BEFORE, AFTER = 0.1, 0.15  # subtitle starts this much before the voice, ends this much after
TARGET_RMS = 10 ** (-20 / 20) * 32767
PEAK = 0.89 * 32767
MAX_MEANING, MAX_NOTE = 15, 40

GEMINI_MODEL = "gemini-2.5-flash-preview-tts"
OPENAI_MODEL = "gpt-4o-mini-tts"
DELIVERY = "natural standard Tokyo Japanese, clear and at a relaxed pace that suits learners, never exaggerated"
SAY_VOICES = ["Kyoko", "Eddy (Japanese (Japan))"]
WHISPER_MODEL = Path.home() / "Library/Application Support/dev.shadowing.app/models/ggml-large-v3-turbo-q8_0.bin"


def fail(message):
    sys.exit(f"build.py: {message}")


# --- the script --------------------------------------------------------------


def load(pack_id):
    source = json.loads((REPO / "scripts/packs" / f"{pack_id}.json").read_text())
    problems = []
    for t, track in enumerate(source["tracks"], 1):
        voices = len(track["speakers"])
        for name, role in track["speakers"]:
            if role not in source["cast"]:
                problems.append(f"{track['name']}: no cast entry {role}")
        for l, (speaker, text, translation, words, points) in enumerate(track["lines"], 1):
            where = f"{t}:{l} {text}"
            if not 0 <= speaker < voices:
                problems.append(f"{where}: speaker {speaker}")
            if not translation.strip():
                problems.append(f"{where}: no translation")
            for word, reading, meaning in words:
                if word not in text:
                    problems.append(f"{where}: word {word} is not in the sentence")
                if len(meaning) > MAX_MEANING:
                    problems.append(f"{where}: meaning of {word} longer than {MAX_MEANING}")
            for point, note in points:
                if len(note) > MAX_NOTE:
                    problems.append(f"{where}: note on {point} longer than {MAX_NOTE}")
    if problems:
        fail("the script has problems:\n  " + "\n  ".join(problems))
    return source


# --- speech ------------------------------------------------------------------


def post(url, body, headers, attempts=5):
    data = json.dumps(body).encode()
    for attempt in range(attempts):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt + 1 < attempts:
                time.sleep(2 ** attempt * 3)
                continue
            fail(f"{url.split('?')[0]} answered {e.code}: {detail}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt * 3)
                continue
            fail(f"{url.split('?')[0]}: {e}")


def gemini(text, voice, style, model):
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or fail("GEMINI_API_KEY is not set")
    prompt = f"Read this Japanese line aloud as {style}. Speak {DELIVERY}. Say only the line itself:\n{text}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    reply = json.loads(post(url, body, {"x-goog-api-key": key}))
    try:
        part = reply["candidates"][0]["content"]["parts"][0]["inlineData"]
    except (KeyError, IndexError):
        fail(f"Gemini sent no audio for {text}: {json.dumps(reply)[:300]}")
    rate = re.search(r"rate=(\d+)", part.get("mimeType", ""))
    if rate and int(rate.group(1)) != RATE:
        fail(f"Gemini audio is {part['mimeType']}, expected {RATE} Hz")
    return base64.b64decode(part["data"])


def openai(text, voice, style, model):
    key = os.environ.get("OPENAI_API_KEY") or fail("OPENAI_API_KEY is not set")
    body = {
        "model": model,
        "voice": voice,
        "input": text,
        "instructions": f"You are {style}. Speak {DELIVERY}.",
        "response_format": "pcm",
    }
    return post("https://api.openai.com/v1/audio/speech", body, {"Authorization": f"Bearer {key}"})


def say(text, voice, _style, _model):
    with tempfile.TemporaryDirectory() as tmp:
        aiff = Path(tmp) / "line.aiff"
        subprocess.run(["say", "-v", voice, "-o", str(aiff), text], check=True)
        return subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(aiff), "-f", "s16le", "-ac", "1", "-ar", str(RATE), "-"],
            check=True,
            capture_output=True,
        ).stdout


ENGINES = {"gemini": gemini, "openai": openai, "say": say}


def clip(cache, engine, model, text, voice, style, redo):
    key = hashlib.sha1(json.dumps([engine, model, voice, style, DELIVERY, text]).encode()).hexdigest()
    path = cache / engine / f"{key}.pcm"
    if redo or not path.exists():
        pcm = ENGINES[engine](text, voice, style, model)
        if len(pcm) < RATE // 5:
            fail(f"{engine} sent almost no audio for {text}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(pcm)
    return path


# --- audio -------------------------------------------------------------------


def trimmed(pcm):
    """The voice without the silence around it, at an even loudness."""
    s = array.array("h", pcm[: len(pcm) // 2 * 2])
    frame = RATE // 100
    rms = [math.sqrt(sum(x * x for x in s[i : i + frame]) / frame) for i in range(0, len(s) - frame, frame)]
    floor = max(max(rms) * 10 ** (-40 / 20), 30)
    voiced = [i for i, r in enumerate(rms) if r > floor]
    start = max(0, (voiced[0] - 3) * frame)  # 30 ms before the first voiced frame
    end = min(len(s), (voiced[-1] + 9) * frame)  # 90 ms after the last: a devoiced す fades out
    s = s[start:end]
    loud = [r for r in rms[voiced[0] : voiced[-1] + 1] if r > floor]
    level = math.sqrt(sum(r * r for r in loud) / len(loud))
    gain = min(TARGET_RMS / level, PEAK / max(1, max(abs(x) for x in s)))
    return array.array("h", (max(-32768, min(32767, round(x * gain))) for x in s))


def build_track(track, cast, engine, model, cache, redo):
    """The track's audio and its sentences with exact times."""
    out = array.array("h", bytes(int(LEAD * RATE) * 2))
    spans = []
    previous = None
    for l, (speaker, text, *_rest) in enumerate(track["lines"], 1):
        role = cast[track["speakers"][speaker][1]]
        voice = SAY_VOICES[speaker % 2] if engine == "say" else role[engine]
        path = clip(cache, engine, model, text, voice, role["style"], (track["number"], l) in redo)
        voice_pcm = trimmed(path.read_bytes())
        if previous is not None:
            gap = SAME_SPEAKER_GAP if speaker == previous else TURN_GAP
            out.extend(array.array("h", bytes(int(gap * RATE) * 2)))
        begin = len(out) / RATE
        out.extend(voice_pcm)
        spans.append((begin, len(out) / RATE, speaker, text, path))
        previous = speaker
    out.extend(array.array("h", bytes(int(TAIL * RATE) * 2)))
    sentences = []
    for i, (begin, end, speaker, text, _) in enumerate(spans):
        start = max(begin - BEFORE, sentences[-1]["end"] if sentences else 0.0)
        stop = end + AFTER
        if i + 1 < len(spans):
            stop = min(stop, spans[i + 1][0] - BEFORE)
        sentences.append({"start": round(start, 3), "end": round(stop, 3), "text": text, "speaker": speaker})
    return out, sentences, [s[4] for s in spans]


def mp3(samples, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", "-",
         "-codec:a", "libmp3lame", "-b:a", "64k", "-map_metadata", "-1", str(dest)],
        input=samples.tobytes(),
        check=True,
    )


# --- checking with Whisper ---------------------------------------------------


DIGITS = {c: i for i, c in enumerate("〇一二三四五六七八九")}
UNITS = {"十": 10, "百": 100, "千": 1000}


def arabic(text):
    """六百八十 → 680, so a numeral written either way compares equal."""
    def value(m):
        total, digit = 0, 0
        for c in m.group(0):
            if c in DIGITS:
                digit = DIGITS[c]
            else:
                total += (digit or 1) * UNITS[c]
                digit = 0
        return str(total + digit)
    return re.sub(r"[〇一二三四五六七八九十百千]+", value, text)


def plain(text):
    text = arabic(text).replace("くらい", "ぐらい")
    return re.sub(r"[\s、。，,.！!？?「」『』…・ー〜\-]", "", text)


def check(tracks, clips):
    """Transcribes every clip; returns the lines whose words don't match the script."""
    if not WHISPER_MODEL.exists():
        fail(f"--check needs {WHISPER_MODEL}")
    report = []
    with tempfile.TemporaryDirectory() as tmp:
        files = []
        for t, (track, paths) in enumerate(zip(tracks, clips), 1):
            for l, path in enumerate(paths, 1):
                wav = Path(tmp) / f"{t:02}-{l:02}.wav"
                # Padded with silence: Whisper makes things up for very short clips.
                subprocess.run(["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(RATE), "-ac", "1", "-i", str(path),
                                "-af", "adelay=700,apad=pad_dur=0.7", "-ar", "16000", str(wav)], check=True)
                files.append((t, l, track["lines"][l - 1][1], wav))
        args = ["whisper-cli", "-m", str(WHISPER_MODEL), "-l", "ja", "-nt", "-np", "-otxt"]
        for *_, wav in files:
            args += ["-f", str(wav)]
        subprocess.run(args, check=True, capture_output=True)
        for t, l, text, wav in files:
            heard = Path(f"{wav}.txt").read_text().strip()
            ratio = difflib.SequenceMatcher(None, plain(text), plain(heard)).ratio()
            if ratio < 0.8:
                report.append(f"{t}:{l}  {ratio:.2f}  script {text}\n            heard  {heard}")
    return report


# --- the pack ----------------------------------------------------------------


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack")
    ap.add_argument("--engine", choices=ENGINES, default="gemini")
    ap.add_argument("--model", help=f"default: {GEMINI_MODEL} / {OPENAI_MODEL}")
    ap.add_argument("--out", type=Path, default=REPO / "site/packs")
    ap.add_argument("--cache", type=Path, default=Path.home() / ".cache/shadowing-packs")
    ap.add_argument("--redo", action="append", default=[], help="t:l, ask again for line l of track t")
    ap.add_argument("--check", action="store_true", help="transcribe every clip with whisper-cli and compare")
    args = ap.parse_args()

    out = args.out.resolve()
    if args.engine == "say" and (REPO / "site") in [out, *out.parents]:
        fail("macOS voices may not be redistributed: --engine say only builds a local test pack (--out elsewhere)")
    model = args.model or {"gemini": GEMINI_MODEL, "openai": OPENAI_MODEL, "say": "say"}[args.engine]
    redo = {tuple(int(n) for n in r.split(":")) for r in args.redo}

    source = load(args.pack)
    folder = out / source["id"] / str(source["version"])
    tracks, clips, total, seconds = [], [], 0, 0.0
    for number, track in enumerate(source["tracks"], 1):
        track["number"] = number
        samples, sentences, paths = build_track(track, source["cast"], args.engine, model, args.cache, redo)
        file = f"{number:02}.mp3"
        mp3(samples, folder / file)
        length = len(samples) / RATE
        seconds += length
        size = (folder / file).stat().st_size
        total += size
        clips.append(paths)
        tracks.append({
            "name": track["name"],
            "file": file,
            "size": size,
            "sha256": sha256(folder / file),
            "duration": round(length, 2),
            "speakers": [name for name, _ in track["speakers"]],
            "sentences": sentences,
            "explanations": [
                {
                    "index": i,
                    "translation": translation,
                    "words": [{"word": w, "reading": r, "meaning": m} for w, r, m in words],
                    "points": [{"point": p, "note": n} for p, n in points],
                }
                for i, (_s, _t, translation, words, points) in enumerate(track["lines"])
            ],
        })
        print(f"{track['name']}: {length:.1f} s, {len(sentences)} sentences")

    voice = {"gemini": f"Google Gemini TTS（{model}）", "openai": f"OpenAI TTS（{model}）", "say": "macOS say（仅测试）"}[args.engine]
    pack = {
        "id": source["id"],
        "version": source["version"],
        "title": source["title"],
        "folder": source["folder"],
        "credits": f"对话、翻译和讲解为 Shadowing 原创；声音由 {voice} 合成（AI 配音）。",
        "tracks": tracks,
    }
    pack_file = folder / "pack.json"
    pack_file.write_text(json.dumps(pack, ensure_ascii=False, indent=1) + "\n")
    total += pack_file.stat().st_size

    manifest_file = out / "manifest.json"
    manifest = json.loads(manifest_file.read_text()) if manifest_file.exists() else {"version": 1, "packs": []}
    entry = {
        "id": source["id"],
        "version": source["version"],
        "title": source["title"],
        "description": source["description"],
        "language": source["language"],
        "level": source["level"],
        "voice": "ai",
        "tracks": len(tracks),
        "duration": round(seconds, 1),
        "size": total,
        "url": f"{source['id']}/{source['version']}/pack.json",
        "sha256": sha256(pack_file),
        "bytes": pack_file.stat().st_size,
    }
    manifest["packs"] = [p for p in manifest["packs"] if p["id"] != source["id"]] + [entry]
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print(f"{source['title']}: {len(tracks)} tracks, {seconds / 60:.1f} min, {total / 1e6:.2f} MB → {folder}")

    if args.check:
        report = check(source["tracks"], clips)
        print("\n".join(["Whisper heard something else in:", *report]) if report else "Whisper heard every line as written.")


if __name__ == "__main__":
    main()
