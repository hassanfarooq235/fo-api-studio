#!/usr/bin/env python3
"""Dev-only static server with caching DISABLED.

    python3 tools/serve.py [port]      # default 8766

Why: the browser heuristically caches responses that carry no Cache-Control
header, so a preview tab can silently run a stale copy of an edited module and
make a fixed bug look broken. `no-store` removes that entire class of confusion.

Usage:
    python3 tools/serve.py
    # then open e.g. http://127.0.0.1:8766/tools/browser.test.html
           http://127.0.0.1:8766/tools/panel.preview.html

This file is never shipped with the extension.
"""

import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    handler = functools.partial(NoStoreHandler, directory=ROOT)
    http.server.HTTPServer.allow_reuse_address = True
    with http.server.HTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {ROOT}\n  -> http://127.0.0.1:{port}/tools/panel.preview.html (no-store)", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
