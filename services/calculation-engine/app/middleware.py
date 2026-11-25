import json
import logging
import time

from fastapi import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.version import ENGINE_VERSION

# A full request is about 1 KB; 64 KB leaves room for long notes and sensitivity lists.
MAX_BODY_BYTES = 64 * 1024

request_log = logging.getLogger("renewablex.request")
if not request_log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(message)s"))
    request_log.addHandler(_handler)
    request_log.setLevel(logging.INFO)
    request_log.propagate = False


def too_large_detail(limit: int) -> list[dict]:
    return [{
        "type": "value_error",
        "code": "request_too_large",
        "loc": ["body"],
        "msg": f"The request body is larger than {limit} bytes.",
    }]


class BodyLimit:
    """Answers 413 when the body exceeds the limit, by Content-Length or by bytes actually received."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > self.max_bytes:
            response = JSONResponse(status_code=413, content={"detail": too_large_detail(self.max_bytes)})
            await response(scope, receive, send)
            return
        seen = 0

        async def limited() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    # FastAPI re-raises HTTPException from body parsing; any other error becomes a 400.
                    raise HTTPException(413, detail=too_large_detail(self.max_bytes))
            return message

        await self.app(scope, limited, send)


class RequestLog:
    """One JSON line per request: method, path, status, duration, engine version. Never the body or query."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        status = 500

        async def capture(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, capture)
        finally:
            request_log.info(json.dumps({
                "method": scope["method"],
                "path": scope["path"],
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                "engine_version": ENGINE_VERSION,
            }))
