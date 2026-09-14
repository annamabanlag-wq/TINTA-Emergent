"""Small startup hook for the existing Render uvicorn target.
The main server remains untouched; this imports the optional artist application routes
immediately after the server module is loaded.
"""
import importlib.abc
import importlib.machinery
import sys


class _ServerLoader(importlib.abc.Loader):
    def __init__(self, spec):
        self.spec = spec
        self.loader = spec.loader

    def create_module(self, spec):
        if hasattr(self.loader, "create_module"):
            return self.loader.create_module(spec)
        return None

    def exec_module(self, module):
        self.loader.exec_module(module)
        try:
            from artist_applications_patch import install
            install(module)
        except Exception as exc:
            print(f"Artist application routes not installed: {exc}")
            raise


class _ServerFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname != "server":
            return None
        spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        if not spec or not spec.loader:
            return None
        spec.loader = _ServerLoader(spec)
        return spec


sys.meta_path.insert(0, _ServerFinder())
