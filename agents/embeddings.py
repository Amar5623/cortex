"""
Local embedding model wrapper for Cortex.

Deliberately local + free (no network dependency to fail mid-demo, no
per-token billing eating AWS/API credit): sentence-transformers'
all-MiniLM-L6-v2, 384 dimensions, matches the VECTOR(384) columns on
runbooks/postmortems in db/schema.sql.

Uses fastembed (ONNX runtime) instead of torch/sentence-transformers to
stay under Lambda's 250MB zip-unzipped limit.
"""

import logging
import os
import pathlib
import shutil
import tarfile

logger = logging.getLogger("cortex.embeddings")

_model = None
_base_dir = pathlib.Path(__file__).parent.parent
_tar_path = _base_dir / "model_cache.tar.gz"
_source_cache_dir = _base_dir / "model_cache"
CACHE_DIR = "/tmp/fastembed_cache"

os.environ["FASTEMBED_CACHE_PATH"] = CACHE_DIR
os.environ["HF_HOME"] = CACHE_DIR
os.environ["XDG_CACHE_HOME"] = CACHE_DIR


def _ensure_model_extracted():
    target_model_dir = pathlib.Path(CACHE_DIR) / "models--qdrant--all-MiniLM-L6-v2-onnx"
    if not target_model_dir.exists():
        pathlib.Path(CACHE_DIR).mkdir(parents=True, exist_ok=True)
        if _tar_path.exists():
            try:
                with tarfile.open(_tar_path, "r:gz") as tar:
                    tar.extractall(path=CACHE_DIR)
            except Exception as e:
                logger.error(f"Failed to extract tar model cache: {e}")
        elif _source_cache_dir.exists():
            try:
                shutil.copytree(_source_cache_dir, CACHE_DIR, dirs_exist_ok=True)
            except Exception as e:
                logger.error(f"Failed to copy model_cache directory: {e}")


def _get_model():
    global _model
    if _model is None:
        _ensure_model_extracted()
        from fastembed import TextEmbedding
        _model = TextEmbedding(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            cache_dir=CACHE_DIR,
        )
    return _model


def embed_text(text: str) -> list[float]:
    """Embed a single string, returning a 384-dim float list ready for
    agents.mcp_client.format_vector()."""
    if not text or not text.strip():
        raise ValueError("embed_text() called with empty text")
    try:
        model = _get_model()
        vec = list(model.embed([text]))[0]
        return vec.tolist()
    except Exception as e:
        logger.error(f"embed_text failed: {e}. Falling back to zero vector.")
        return [0.0] * 384