import os
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def load_environment():
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        name, value = clean.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


@dataclass
class Settings:
    database_url: str
    ai_base_url: str
    model: str
    vision_model: str
    review_model: str
    api_key: str
    data_dir: Path

    @classmethod
    def from_environment(cls):
        load_environment()
        model = os.getenv("AI_MODEL", "deepseek-flash")
        return cls(os.getenv("DATABASE_URL", "postgresql://postgres@127.0.0.1:55432/zhijian"),
                   os.getenv("AI_BASE_URL", "https://api.deepseek.com").rstrip("/"), model,
                   os.getenv("AI_VISION_MODEL", model), os.getenv("AI_REVIEW_MODEL", model),
                   os.getenv("DEEPSEEK_API_KEY", "").strip(), ROOT / "data")
