from fastapi import FastAPI

from app.api.pv import router as pv_router
from app.version import ENGINE_VERSION

app = FastAPI(
    title="RenewableX Calculation Engine",
    version=ENGINE_VERSION,
    description="Preliminary PV energy and unlevered project-finance calculations.",
)
app.include_router(pv_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "renewablex-calculation-engine", "engine_version": ENGINE_VERSION}
