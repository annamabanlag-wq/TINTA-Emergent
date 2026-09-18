"""Load the existing TINTA backend startup patches when running from repo root."""
from pathlib import Path
import importlib.util
import sys

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

PATCH = BACKEND_DIR / "sitecustomize.py"
spec = importlib.util.spec_from_file_location("_tinta_backend_sitecustomize", PATCH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {PATCH}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
