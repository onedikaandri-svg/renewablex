import os

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.pv import router as pv_router
from app.api.sensitivity import router as sensitivity_router
from app.middleware import BodyLimit, RequestLog
from app.version import ENGINE_VERSION

app = FastAPI(
    title="RenewableX Calculation Engine",
    version=ENGINE_VERSION,
    description="Preliminary PV energy and unlevered project-finance calculations.",
)

# Browsers may call the API only from these origins (comma separated in ALLOWED_ORIGINS).
origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
# The first one added is the innermost: CORS wraps the body limit so a 413 still carries CORS headers,
# and the request log wraps everything so every status is logged.
app.add_middleware(BodyLimit)
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
app.add_middleware(RequestLog)
app.include_router(pv_router)
app.include_router(sensitivity_router)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    """Same items as FastAPI's default, plus a stable `code`, and without echoing the input."""
    items = []
    for e in exc.errors():
        ctx = dict(e.get("ctx") or {})
        cause = ctx.pop("error", None)
        item = {"type": e["type"], "code": getattr(cause, "code", e["type"]), "loc": list(e["loc"]), "msg": e["msg"]}
        if ctx:
            item["ctx"] = ctx
        items.append(item)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(items)})


@app.get("/health")
def health():
    return {"status": "ok", "service": "renewablex-calculation-engine", "engine_version": ENGINE_VERSION}
