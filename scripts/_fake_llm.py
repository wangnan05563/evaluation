# -*- coding: utf-8 -*-
# 临时：最小 OpenAI 兼容端点，用于验证 /api/config/test 成功路径
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        self.rfile.read(n)
        auth = self.headers.get("Authorization") or ""
        body = json.dumps({
            "id": "fake",
            "choices": [{"message": {"role": "assistant", "content": "pong:" + auth[-4:]}}],
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass  # 静默：假 LLM 服务不产生访问日志


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8021), H).serve_forever()
