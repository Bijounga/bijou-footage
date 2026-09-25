# Transcription worker for Bijou Footage. Runs in its own Python venv
# (~/.bijou-footage/whisper/venv), started by electron/main/transcribe.js.
#
# Keeps the model loaded on the GPU and takes jobs as JSON lines on stdin:
#   {"id", "src", "stream", "duration", "out", "ffmpeg", "lang"}
# Reports JSON lines on stdout: ready / progress / done / error.
#
# Audio is decoded by ffmpeg in CHUNK-second pieces (16 kHz mono float32)
# so a 10-hour recording never has to sit in memory at once, and progress
# comes out as each piece finishes. Timestamps are offset back to recording
# time. Output: {"v":1, "model", "lang", "segments": [[start, end, text, [[ws, we, word], ...]], ...]}

import sys, os, json, subprocess, glob, time
from concurrent.futures import ThreadPoolExecutor

CHUNK = 20 * 60  # s
MODEL = os.environ.get("BIJOU_WHISPER_MODEL", "large-v3-turbo")
MODELS_DIR = os.environ.get("BIJOU_WHISPER_MODELS")


def say(**msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def add_cuda_dlls():
    # pip's nvidia-cublas-cu12 / nvidia-cudnn-cu12 put their DLLs here;
    # ctranslate2 needs them on the DLL search path.
    import site
    for sp in site.getsitepackages():
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            os.add_dll_directory(d)
            os.environ["PATH"] = d + os.pathsep + os.environ["PATH"]


def load_model():
    add_cuda_dlls()
    from faster_whisper import WhisperModel, BatchedInferencePipeline
    model = WhisperModel(MODEL, device="cuda", compute_type="float16", download_root=MODELS_DIR)
    return BatchedInferencePipeline(model=model)


def read_chunk(ffmpeg, src, stream, start, length):
    import numpy as np
    cmd = [ffmpeg, "-nostdin", "-v", "error", "-ss", str(start), "-t", str(length), "-i", src,
           "-map", "0:a:%d" % stream, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0:
        raise RuntimeError("ffmpeg: " + p.stderr.decode("utf8", "replace")[-400:])
    return np.frombuffer(p.stdout, dtype=np.float32)


def split_lines(words):
    # The batched pipeline returns ~30 s blocks. Break them into readable
    # lines: at a pause, at the end of a sentence, or at a comma once a
    # line is getting long.
    out, cur = [], []
    for w in words:
        if cur:
            prev = cur[-1]
            gap = w.start - prev.end
            dur = prev.end - cur[0].start
            ends = prev.word.strip()[-1:]
            if gap > 0.6 or (ends in ".?!" and len(cur) >= 3) or (dur > 8 and ends == ",") or dur > 14:
                out.append(cur)
                cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    return out


def run_job(pipe, job):
    duration = float(job["duration"])
    lang = job.get("lang") or None
    segments = []
    # Decode the next chunk (ffmpeg, disk + CPU) while this one is on the GPU.
    starts = []
    t = 0.0
    while t < duration:
        starts.append(t)
        t += CHUNK
    fetch = lambda st: read_chunk(job["ffmpeg"], job["src"], job["stream"], st, min(CHUNK, duration - st) + 1)
    pool = ThreadPoolExecutor(max_workers=1)
    nxt = pool.submit(fetch, starts[0]) if starts else None
    for ci, start in enumerate(starts):
        length = min(CHUNK, duration - start)
        audio = nxt.result()
        nxt = pool.submit(fetch, starts[ci + 1]) if ci + 1 < len(starts) else None
        if audio.size > 1600:
            segs, _info = pipe.transcribe(audio, language=lang, batch_size=16, word_timestamps=True,
                                          condition_on_previous_text=False)
            for s in segs:
                if s.start >= length:
                    continue  # in the 1 s overlap tail — the next chunk has it
                if not s.words:
                    text = s.text.strip()
                    if text:
                        segments.append([round(start + s.start, 2), round(start + s.end, 2), text, []])
                    continue
                for piece in split_lines(s.words):
                    words = [[round(start + w.start, 2), round(start + w.end, 2), w.word.strip()] for w in piece]
                    text = "".join(w.word for w in piece).strip()
                    if text:
                        segments.append([words[0][0], words[-1][1], text, words])
        say(type="progress", id=job["id"], done=min(start + CHUNK, duration), duration=duration)
    pool.shutdown(wait=False)
    segments.sort(key=lambda s: s[0])
    tmp = job["out"] + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump({"v": 1, "model": MODEL, "lang": lang, "segments": segments}, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, job["out"])
    say(type="done", id=job["id"], segments=len(segments))


def main():
    try:
        t = time.time()
        pipe = load_model()
        say(type="ready", model=MODEL, secs=round(time.time() - t, 1))
    except Exception as e:
        say(type="fatal", message=repr(e))
        return
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = json.loads(line)
        try:
            run_job(pipe, job)
        except Exception as e:
            say(type="error", id=job.get("id"), message=repr(e))


if __name__ == "__main__":
    main()
