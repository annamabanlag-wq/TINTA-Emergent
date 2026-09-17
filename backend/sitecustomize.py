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
            from cors_patch import install as install_cors
            install_cors(module)
            from artist_applications_patch import install as install_artist
            install_artist(module)
            from email_validation_patch import install as install_email_validation
            install_email_validation(module)
            from email_verification_patch import install as install_email_verification
            install_email_verification(module)
            from email_verification_route_fix import install as install_email_verification_route_fix
            install_email_verification_route_fix(module)
            from gcash_only_patch import install as install_gcash_only
            install_gcash_only(module)
            from gcash_security_patch import install as install_gcash_security
            install_gcash_security(module)
            from artist_portal_patch import install as install_artist_portal
            install_artist_portal(module)
            from chat_patch import install as install_chat
            install_chat(module)
            from chat_contacts_patch import install as install_chat_contacts
            install_chat_contacts(module)
            from artist_chat_repair import install as install_artist_chat_repair
            install_artist_chat_repair(module)
            from chat_contacts_force_patch import install as install_chat_contacts_force
            install_chat_contacts_force(module)
            from chat_customer_contacts_patch import install as install_customer_chat_contacts
            install_customer_chat_contacts(module)
            from chat_contacts_v2_patch import install as install_chat_contacts_v2
            install_chat_contacts_v2(module)
            from booking_guard_patch import install as install_booking_guard
            install_booking_guard(module)
            from test_accounts_patch import install as install_test_accounts
            install_test_accounts(module)
            from auth_session_patch import install as install_auth_session
            install_auth_session(module)
            from auth_session_bridge import install as install_auth_session_bridge
            install_auth_session_bridge(module)
            from artist_registration_role_patch import install as install_artist_registration_role
            install_artist_registration_role(module)
            from artist_identity_response_patch import install as install_artist_identity_response
            install_artist_identity_response(module)
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
