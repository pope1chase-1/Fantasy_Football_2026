#!/usr/bin/env python3
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen

APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwMs3lszBizP27V2V32PiLAV7mIcSKRijDmC_OkwEdW6-Uj0DlpoHQvfxCpBFOHQb_sGQ/exec"


class AppProxyHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/read"):
            self.handle_read_proxy()
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/write"):
            self.handle_write_proxy()
            return
        self.send_json({"ok": False, "error": "Unsupported POST endpoint."}, status=404)

    def handle_read_proxy(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        sheet = params.get("sheet", ["Rosters"])[0]
        url = f"{APP_SCRIPT_URL}?action=read&sheet={quote(sheet)}"
        self.forward_upstream("GET", url, None)

    def handle_write_proxy(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        self.forward_upstream("POST", APP_SCRIPT_URL, raw_body)

    def forward_upstream(self, method, target_url, raw_body):
        headers = {
            "Accept": "application/json",
        }

        if method == "POST":
            headers["Content-Type"] = "application/json"
            request = Request(target_url, data=raw_body or b"{}", headers=headers, method="POST")
        else:
            request = Request(target_url, headers=headers, method="GET")

        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(payload)
        except HTTPError as exc:
            body = exc.read() or json.dumps({"ok": False, "error": exc.reason}).encode("utf-8")
            self.send_response(exc.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
        except URLError as exc:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            detail = getattr(exc, "reason", str(exc))
            self.wfile.write(json.dumps({"ok": False, "error": "Upstream fetch failed", "detail": str(detail)}).encode("utf-8"))

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    root = str(Path(__file__).resolve().parent)
    os_dir = Path(root)
    os.chdir(os_dir)

    port = 8002
    print(f"Serving {root} on http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), AppProxyHandler).serve_forever()
