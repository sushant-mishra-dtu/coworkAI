from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from db import init_db
from router_manager import load_all_configs_on_startup

from routes.config_routes import router as config_router
from routes.llm_routes import router as llm_router, GuardrailBlockException
from routes.catalog_routes import router as catalog_router
from routes.usage_routes import router as usage_router
from routes.guardrail_routes import router as guardrail_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    load_all_configs_on_startup()
    yield

app = FastAPI(title="LLM Configurator", lifespan=lifespan)

@app.exception_handler(GuardrailBlockException)
async def guardrail_block_exception_handler(request: Request, exc: GuardrailBlockException):
    # Pre-stage block. Usage log is omitted here (as it never hit the router), but we return the structured refusal.
    return JSONResponse(
        status_code=200,
        content={"blocked": True, "reason": exc.reason}
    )

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(config_router)
app.include_router(llm_router)
app.include_router(catalog_router)
app.include_router(usage_router)
app.include_router(guardrail_router)
