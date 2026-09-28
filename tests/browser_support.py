from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os, threading

ROOT = Path(__file__).resolve().parents[1]
def chromium_options():
    configured = os.environ.get('CUEMIND_CHROMIUM')
    if configured:
        return {'executable_path': configured}
    cached = sorted((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-*/chrome-mac-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
    return {'executable_path': str(cached[-1])} if cached else {'channel': 'chromium'}

@contextmanager
def preview_server():
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown(); server.server_close(); thread.join()
