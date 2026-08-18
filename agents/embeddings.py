"""
Local embedding model wrapper for Cortex.

Deliberately local + free (no network dependency to fail mid-demo, no
per-token billing eating AWS/API credit): sentence-transformers'
all-MiniLM-L6-v2, 384 dimensions, matches the VECTOR(384) columns on
runbooks/postmortems in db/schema.sql.

Uses fastembed (ONNX runtime) instead of torch/sentence-transformers to
stay under Lambda's 250MB zip-unzipped limit. Same model, same 384-dim
output, different execution engine — see project notes re: the switch.

The model is loaded lazily on first use and cached at module scope, since
loading it is relatively slow (~1-2s) and each Lambda invocation should
only pay that cost once per warm instance, not once per call.
"""

_model = None


def _get_model():
    global _model
    if _model is None:
        # Imported lazily so agents/graph.py and other modules that don't
        # need embeddings don't pay the import cost, and so this file can
        # be imported before fastembed is installed without blowing up
        # other tests.
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _model


def embed_text(text: str) -> list[float]:
    """Embed a single string, returning a 384-dim float list ready for
    agents.mcp_client.format_vector()."""
    if not text or not text.strip():
        raise ValueError("embed_text() called with empty text")
    model = _get_model()
    # fastembed.TextEmbedding.embed() returns a generator of numpy arrays
    vec = list(model.embed([text]))[0]
    return vec.tolist()