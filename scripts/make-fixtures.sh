#!/usr/bin/env bash
# Generates the test audio folder used by `npm run smoke`. Needs macOS `say` and ffmpeg.
# Usage: scripts/make-fixtures.sh <output folder>
set -euo pipefail
out="${1:?usage: scripts/make-fixtures.sh <output folder>}"
mkdir -p "$out/Unit 2"
tmp=$(mktemp -d)
say -v Kyoko -o "$tmp/ja.aiff" "今日はいい天気ですね。散歩に行きましょう。駅の近くに新しいカフェができました。"
say -v Samantha -o "$tmp/en.aiff" "The quick brown fox jumps over the lazy dog. Shadowing means repeating what you hear, right after you hear it."
ff() { ffmpeg -loglevel error -y "$@"; }
ff -i "$tmp/ja.aiff" -c:a aac -b:a 128k "$out/01 日本語 天気.m4a"
ff -i "$tmp/en.aiff" -c:a libmp3lame -q:a 4 "$out/02 English VBR.mp3"
ff -i "$tmp/en.aiff" -c:a libmp3lame -b:a 128k "$out/10 English CBR.mp3"
ff -i "$tmp/ja.aiff" "$out/Unit 2/03 wav sample.wav"
ff -f lavfi -i "sine=frequency=440:duration=600" -af "volume=0.2" -c:a libmp3lame -q:a 5 "$out/Unit 2/04 Long tone 10min VBR.mp3"
echo "notes" > "$out/readme.txt"
# Sidecar subtitles: picked up as the transcript of "02 English VBR.mp3".
printf '1\n00:00:00,000 --> 00:00:02,600\nThe quick brown fox jumps over the lazy dog.\n\n2\n00:00:02,900 --> 00:00:07,500\nShadowing means repeating what you hear,\nright after you hear it.\n' > "$out/02 English VBR.srt"
rm -rf "$tmp"
echo "fixtures written to $out"
