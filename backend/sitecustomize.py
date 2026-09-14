"""Small startup hook for the existing Render uvicorn target."""
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
            from artist_applications_patch import install as install_artist
            install_artist(module)
            from email_validation_patch import install as install_email_validation
            install_email_validation(module)
            from email_verification_patch import install as install_email_verification
            install_email_verification(module)
            from email_verification_route_fix import install as install_email_route_fix
            install_email_route_fix(module)
            from gcash_only_patch import install as install_gcash_only
            install_gcash_only(module)
        except Exception as exc:
            print(f"TINTA startup patches not installed: {exc}")
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
