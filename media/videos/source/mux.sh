#!/bin/sh
# mux.sh <out/name>  — synthesize the score from name.cues.json and mux it onto name.silent.mp4
set -e
python3 synth.py "$1.cues.json" "$1.wav"
ffmpeg -loglevel error -y -i "$1.silent.mp4" -i "$1.wav" -map 0:v -map 1:a -c:v copy -af loudnorm=I=-16:TP=-1.5:LRA=9 -ar 48000 -c:a aac -b:a 192k -shortest -movflags +faststart "$1.mp4"
