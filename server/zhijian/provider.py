import asyncio
import base64
import json
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

import httpx


class AIUnavailable(Exception):
    pass


class AIError(Exception):
    pass


class Provider:
    def __init__(self, settings):
        self.settings = settings
        self.limiter = asyncio.Semaphore(8)

    def require_key(self):
        if not self.settings.api_key:
            raise AIUnavailable("尚未在本机 .env 配置 DEEPSEEK_API_KEY；不会生成模拟题面或教案")

    async def json(self, *, prompt, model, system, evidence_dir: Path, name, images=None, interactive=False):
        self.require_key()
        if model == "deepseek-v4-pro" and images:
            raise AIError("deepseek-v4-pro不支持图片，请使用已配置的Flash视觉模型提取，再用Pro处理文本教学")
        content = [{"type": "text", "text": prompt}]
        for image in images or []:
            data = base64.b64encode(image).decode()
            content.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + data, "detail": "high"}})
        request = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
                   "response_format": {"type": "json_object"}, "stream": False, "max_tokens": 16000,
                   "thinking": {"type": "disabled"}}
        if model == "deepseek-v4-pro":
            request.update(thinking={"type": "enabled"}, reasoning_effort="low" if interactive else "high", max_tokens=32768)
        evidence_dir.mkdir(parents=True, exist_ok=True)
        # Deliberately exclude headers, secrets and base64 media from the retained request.
        safe_request = {"model": model, "system": system, "prompt": prompt, "imageCount": len(images or []),
                        "thinking": request["thinking"], "maxTokens": request["max_tokens"], "reasoningEffort": request.get("reasoning_effort"),
                        "interactive": interactive, "profile": "interactive" if interactive else "background",
                        "startedAt": datetime.now(timezone.utc).isoformat()}
        started = perf_counter()
        (evidence_dir / f"{name}-request.json").write_text(json.dumps(safe_request, ensure_ascii=False, indent=2))
        try:
            async with self.limiter:
                safe_request["queueWaitMs"] = round((perf_counter() - started) * 1000, 3)
                safe_request["httpStartedAt"] = datetime.now(timezone.utc).isoformat()
                async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=20)) as client:
                    for attempt in range(3):
                        try:
                            response = await client.post(self.settings.ai_base_url + "/chat/completions", headers={"Authorization": "Bearer " + self.settings.api_key}, json=request)
                        except httpx.HTTPError as exc:
                            raise AIError("AI请求连接或读取失败（" + type(exc).__name__ + "），已保留任务可重试") from None
                        if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                            await asyncio.sleep(1 + attempt)
                            continue
                        if response.status_code >= 400:
                            if response.status_code in {401, 403}:
                                raise AIError("AI服务拒绝认证，请检查本机 DeepSeek 密钥和模型权限")
                            raise AIError(f"AI服务返回HTTP {response.status_code}，请求未作为成功结果")
                        try:
                            body = response.json()
                            choice = body["choices"][0]
                            raw = choice["message"]["content"]
                            (evidence_dir / f"{name}-response.json").write_text(json.dumps({"model": body.get("model"), "finishReason": choice.get("finish_reason"), "usage": body.get("usage"), "content": raw}, ensure_ascii=False, indent=2))
                            if choice.get("finish_reason") == "length":
                                raise AIError("模型输出被截断；保留失败，不能当作完整课程")
                            start, end = raw.find("{"), raw.rfind("}")
                            parsed = json.loads(raw[start:end + 1])
                            if not isinstance(parsed, dict):
                                raise ValueError("JSON object required")
                            return parsed
                        except (ValueError, KeyError, TypeError, IndexError):
                            raise AIError("模型输出格式无法解析，原始输出已保留供校对") from None
            raise AIError("AI服务暂不可用")
        finally:
            safe_request["finishedAt"] = datetime.now(timezone.utc).isoformat()
            safe_request["elapsedMs"] = round((perf_counter() - started) * 1000, 3)
            (evidence_dir / f"{name}-request.json").write_text(json.dumps(safe_request, ensure_ascii=False, indent=2))
