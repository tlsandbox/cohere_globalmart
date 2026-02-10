from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from retailnext_outfit_assistant.service import OutfitAssistantService


class SearchRequest(BaseModel):
    query: str = Field(min_length=1)
    shopper_name: str = "Bob"
    top_k: int = Field(default=10, ge=1, le=20)


class CheckMatchRequest(BaseModel):
    session_id: str
    product_id: int


WEB_DIR = Path(__file__).resolve().parent / "web"
SUPPORTED_HOME_GENDERS = {"women": "Women", "men": "Men"}

app = FastAPI(title="GlobalMart Fashion Assistant Demo", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:8005",
        "http://127.0.0.1:8006",
        "http://127.0.0.1:8007",
        "http://127.0.0.1:8008",
        "http://127.0.0.1:8009",
        "http://localhost:8005",
        "http://localhost:8006",
        "http://localhost:8007",
        "http://localhost:8008",
        "http://localhost:8009",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")

service = OutfitAssistantService(root_dir=ROOT_DIR)


@app.get("/")
def home_page() -> FileResponse:
    return FileResponse(str(WEB_DIR / "index.html"))


@app.get("/personalized")
def personalized_page() -> FileResponse:
    return FileResponse(str(WEB_DIR / "personalized.html"))


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": "globalmart-fashion-assistant",
        "stats": service.stats(),
    }


@app.get("/api/profile")
def profile() -> dict:
    return {
        "shopper_name": "Bob",
        "membership_tier": "GlobalMart Fashion Plus",
        "cart_items": 0,
    }


@app.get("/api/home-products")
def home_products(limit: int = 24, gender: str | None = None) -> dict:
    safe_limit = max(6, min(limit, 60))
    normalized_gender = None
    if gender:
        normalized_gender = SUPPORTED_HOME_GENDERS.get(gender.strip().lower())
        if normalized_gender is None:
            raise HTTPException(status_code=400, detail="gender must be one of: Women, Men")

    products = service.home_feed(limit=safe_limit, gender=normalized_gender)
    return {
        "shopper_name": "GlobalMart Fashion Shopper",
        "gender_filter": normalized_gender,
        "products": products,
    }


@app.post("/api/search")
def search(request: SearchRequest) -> dict:
    try:
        return service.search_by_text(
            query=request.query,
            shopper_name=request.shopper_name,
            top_k=request.top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Missing audio filename.")

    payload = await audio.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded audio is empty.")

    try:
        return service.transcribe_voice(audio_bytes=payload, filename=audio.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/image-match")
async def image_match(
    image: UploadFile = File(...),
    shopper_name: str = Form(default="Bob"),
    top_k: int = Form(default=10),
) -> dict:
    if not image.filename:
        raise HTTPException(status_code=400, detail="Missing image filename.")

    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    safe_top_k = max(1, min(top_k, 20))
    try:
        return service.search_by_image(
            image_bytes=payload,
            shopper_name=shopper_name,
            top_k=safe_top_k,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/personalized/{session_id}")
def personalized(session_id: str) -> dict:
    try:
        return service.get_personalized(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/check-match")
def check_match(request: CheckMatchRequest) -> dict:
    try:
        return service.check_match(session_id=request.session_id, product_id=request.product_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/image/{product_id}")
def product_image(product_id: int):
    local_path = service.image_path_for_product(product_id)
    if local_path is not None:
        return FileResponse(str(local_path))
    return RedirectResponse(service.fallback_image_url(product_id))
