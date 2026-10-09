#!/usr/bin/env python3
"""Tiny OpenAI-compatible transcription server for `npm run smoke`.

Answers /v1/models, /v1/audio/transcriptions (a fixed verbose_json) and
/v1/chat/completions (a fixed proofreading or explanation reply), so the real app can be
tested end to end without a network or API key.
Usage: scripts/fake-whisper.py <port>
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPLY = {
    "text": "Fake sentence one. Fake two.",
    "segments": [
        {"start": 0.3, "end": 1.2, "text": " Fake sentence one.", "avg_logprob": -0.2, "no_speech_prob": 0.01},
        {"start": 1.5, "end": 2.5, "text": " Fake two.", "avg_logprob": -0.2, "no_speech_prob": 0.01},
    ],
    "words": [
        {"word": "Fake", "start": 0.3, "end": 0.6},
        # Some servers say how sure they were of each word; this one is a likely mishearing.
        {"word": "sentence", "start": 0.6, "end": 0.9, "probability": 0.2},
        {"word": "one", "start": 0.9, "end": 1.2},
        {"word": "Fake", "start": 1.5, "end": 2.0},
        {"word": "two", "start": 2.0, "end": 2.5},
    ],
}

# An explanation comes back for a request that asks for one sentence to be explained.
EXPLANATION = '{"translation": "测试译文", "words": [{"word": "two", "reading": "", "meaning": "二"}], "points": []}'

# The fix comes back only if the request marked the unsure word (see REPLY) as 〔sentence〕;
# the second one (no change) must be dropped by the app.
FIXES = '{"fixes": [{"id": 0, "from": "sentence", "to": "sentinel", "reason": "测试"}, {"id": 1, "from": "Fake", "to": "Fake"}]}'


class Handler(BaseHTTPRequestHandler):
    def reply(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply({"data": [{"id": "fake-whisper"}]})

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("content-length", 0)))
        if self.path.endswith("/chat/completions"):
            if b"Sentence to explain" in body:
                self.reply({"choices": [{"message": {"role": "assistant", "content": EXPLANATION}}]})
                return
            content = FIXES if "〔sentence〕".encode() in body else '{"fixes": []}'
            self.reply({"choices": [{"message": {"role": "assistant", "content": content}}]})
            return
        ok = b"verbose_json" in body and b"audio/wav" in body
        if not ok:
            self.send_response(400)
            self.end_headers()
            return
        self.reply(REPLY)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
