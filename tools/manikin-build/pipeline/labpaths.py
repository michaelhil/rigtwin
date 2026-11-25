# Where the avatar lab's working data live: the downloads (MakeHuman packs, MPFB2, CMU motion, Poly Haven, SOMA-X), the
# builders' caches and outputs (B1 to B9, RP, RR), the packages. Never in the repository (work/ is not committed).
# MANIKIN_LAB in the environment wins; otherwise "lab" in tools/manikin-build/config.json (relative to the repository root,
# or absolute); otherwise <repository>/work/avatar-lab. The copied scripts read it as __import__("labpaths").LAB.
import json, os

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.normpath(os.path.join(_HERE, "..", "..", ".."))


def _lab():
    if os.environ.get("MANIKIN_LAB"):
        return os.path.abspath(os.environ["MANIKIN_LAB"])
    cfg = os.path.join(_HERE, "..", "config.json")
    if os.path.exists(cfg):
        v = json.load(open(cfg)).get("lab")
        if v:
            return os.path.normpath(os.path.join(_REPO, v))
    return os.path.join(_REPO, "work", "avatar-lab")


LAB = _lab()
