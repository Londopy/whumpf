from .base import BulletinAdapter, get_adapter, register  # noqa: F401
from .schema import Bulletin, Danger, Problem, Source  # noqa: F401

# Imported for the @register side effect.
from . import avalanche_org  # noqa: F401,E402
from . import nzaa  # noqa: F401,E402

__all__ = [
    "Bulletin",
    "BulletinAdapter",
    "Danger",
    "Problem",
    "Source",
    "get_adapter",
    "register",
]
