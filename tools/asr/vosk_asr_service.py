import argparse
import base64
import json
import os
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO


DEFAULT_PORT = 3301
DEFAULT_SAMPLE_RATE = 16000
MAX_JSON_BYTES = 48 * 1024 * 1024
MODEL_CACHE = {}


def clamp_int(value, fallback, min_value, max_value):
    try:
        numeric = int(round(float(value)))
    except (TypeError, ValueError):
        return fallback
    return min(max(numeric, min_value), max_value)


def resolve_model_path(repo_root, model_path):
    raw = str(model_path or "").strip()
    if raw:
        candidate = raw if os.path.isabs(raw) else os.path.abspath(os.path.join(repo_root, raw))
    else:
        candidate = os.path.abspath(os.path.join(repo_root, "models", "vosk", "vosk-model-small-cn-0.22"))
    if not os.path.isdir(candidate):
        raise RuntimeError(
            "Vosk model directory not found: "
            + candidate
            + ". Run npm run install:vosk-model, or set Settings -> ASR -> Model Path to an installed Vosk model directory."
        )
    return candidate


def get_model(repo_root, model_path):
    resolved = resolve_model_path(repo_root, model_path)
    if resolved in MODEL_CACHE:
        return MODEL_CACHE[resolved], resolved

    from vosk import Model, SetLogLevel

    SetLogLevel(-1)
    model = Model(resolved)
    MODEL_CACHE[resolved] = model
    return model, resolved


def parse_audio(audio_bytes, sample_rate):
    try:
        with wave.open(BytesIO(audio_bytes), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise RuntimeError("Vosk ASR expects mono 16-bit PCM WAV audio.")
            return wav.readframes(wav.getnframes()), wav.getframerate()
    except wave.Error:
        return audio_bytes, sample_rate


def recognize(repo_root, payload):
    audio_base64 = str(payload.get("audioBase64") or "").strip()
    if not audio_base64:
        raise RuntimeError("audioBase64 is required.")

    sample_rate = clamp_int(payload.get("sampleRate"), DEFAULT_SAMPLE_RATE, 8000, 48000)
    model, model_path = get_model(repo_root, payload.get("modelPath"))
    audio_bytes = base64.b64decode(audio_base64)
    pcm, wav_sample_rate = parse_audio(audio_bytes, sample_rate)
    sample_rate = clamp_int(wav_sample_rate, sample_rate, 8000, 48000)
    if not pcm:
        raise RuntimeError("Audio payload is empty.")

    from vosk import KaldiRecognizer

    recognizer = KaldiRecognizer(model, sample_rate)
    if payload.get("words"):
        recognizer.SetWords(True)
    max_alternatives = clamp_int(payload.get("maxAlternatives"), 0, 0, 10)
    if max_alternatives > 0:
        recognizer.SetMaxAlternatives(max_alternatives)
    recognizer.AcceptWaveform(pcm)
    result = json.loads(recognizer.FinalResult() or "{}")
    alternatives = sorted(
        (
            item
            for item in result.get("alternatives", [])
            if isinstance(item, dict) and str(item.get("text") or "").strip()
        ),
        key=lambda item: float(item.get("confidence") or 0),
        reverse=True,
    )
    return {
        "text": str((alternatives[0].get("text") if alternatives else result.get("text")) or "").strip(),
        "result": result,
        "sampleRate": sample_rate,
        "modelPath": model_path,
    }


class AsrHandler(BaseHTTPRequestHandler):
    repo_root = os.getcwd()

    def log_message(self, format, *args):
        return

    def send_json(self, status, body):
        encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/healthz":
            self.send_json(200, {"ok": True, "service": "vosk-asr-python"})
            return
        self.send_json(404, {"success": False, "error": "Not Found"})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/asr":
            self.send_json(404, {"success": False, "error": "Not Found"})
            return

        try:
            content_length = clamp_int(self.headers.get("Content-Length"), 0, 0, MAX_JSON_BYTES + 1)
            if content_length > MAX_JSON_BYTES:
                raise RuntimeError("ASR request is too large.")
            raw_body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(raw_body or "{}")
            data = recognize(self.repo_root, payload)
            self.send_json(200, {"success": True, "data": data})
        except Exception as error:
            self.send_json(500, {"success": False, "error": str(error) or "ASR failed"})


def main():
    parser = argparse.ArgumentParser(description="Yachiyo local Vosk ASR service.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--repo-root", default=os.environ.get("YACHIYO_REPO_ROOT") or os.getcwd())
    args = parser.parse_args()

    AsrHandler.repo_root = os.path.abspath(args.repo_root)
    server = ThreadingHTTPServer(("127.0.0.1", clamp_int(args.port, DEFAULT_PORT, 1, 65535)), AsrHandler)
    print(f"Yachiyo Python Vosk ASR service listening on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
