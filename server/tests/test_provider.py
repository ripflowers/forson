import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from zhijian.provider import AIError, Provider


def provider_with_transport(monkeypatch, captured):
    real_client = httpx.AsyncClient
    def handler(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={"model": captured[-1]["model"], "choices": [{"finish_reason": "stop", "message": {"content": '{"ok":true}'}}]})
    monkeypatch.setattr("zhijian.provider.httpx.AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    return Provider(SimpleNamespace(api_key="test-only-not-a-real-key", ai_base_url="https://api.deepseek.com"))


@pytest.mark.asyncio
async def test_pro_text_uses_enabled_high_reasoning_and_larger_output(monkeypatch, tmp_path):
    captured = []
    provider = provider_with_transport(monkeypatch, captured)
    assert await provider.json(prompt="JSON教学测试", model="deepseek-v4-pro", system="测试", evidence_dir=tmp_path, name="pro") == {"ok": True}
    assert captured[0]["thinking"] == {"type": "enabled"}
    assert captured[0]["reasoning_effort"] == "high"
    assert captured[0]["max_tokens"] == 32768
    assert captured[0]["response_format"] == {"type": "json_object"}


@pytest.mark.asyncio
async def test_flash_vision_keeps_disabled_thinking_and_image_payload(monkeypatch, tmp_path):
    captured = []
    provider = provider_with_transport(monkeypatch, captured)
    await provider.json(prompt="JSON提取测试", model="deepseek-flash", system="测试", evidence_dir=tmp_path, name="flash", images=[b"test-only-image"])
    assert captured[0]["thinking"] == {"type": "disabled"}
    assert captured[0]["max_tokens"] == 16000
    assert "reasoning_effort" not in captured[0]
    assert captured[0]["messages"][1]["content"][1]["type"] == "image_url"


@pytest.mark.asyncio
async def test_pro_rejects_images_before_sending_any_request(monkeypatch, tmp_path):
    captured = []
    provider = provider_with_transport(monkeypatch, captured)
    with pytest.raises(AIError, match="不支持图片"):
        await provider.json(prompt="测试", model="deepseek-v4-pro", system="测试", evidence_dir=tmp_path, name="invalid", images=[b"test-only-image"])
    assert captured == []


@pytest.mark.asyncio
async def test_pro_interactive_uses_low_reasoning_with_timing_metadata(monkeypatch, tmp_path):
    captured = []
    provider = provider_with_transport(monkeypatch, captured)
    await provider.json(prompt="JSON追问测试", model="deepseek-v4-pro", system="测试", evidence_dir=tmp_path, name="ask", interactive=True)
    assert captured[0]["thinking"] == {"type": "enabled"}
    assert captured[0]["reasoning_effort"] == "low"
    assert captured[0]["max_tokens"] == 32768
    metadata = json.loads((tmp_path / "ask-request.json").read_text())
    assert metadata["interactive"] is True
    assert metadata["startedAt"] and metadata["finishedAt"]
    assert metadata["elapsedMs"] >= 0
    assert metadata["queueWaitMs"] >= 0


@pytest.mark.asyncio
async def test_provider_global_cap_eight_never_sends_ninth_before_release(monkeypatch, tmp_path):
    real_client = httpx.AsyncClient
    eight_started, release = asyncio.Event(), asyncio.Event()
    active, peak, starts = 0, 0, 0
    async def handler(request):
        nonlocal active, peak, starts
        active += 1
        starts += 1
        peak = max(peak, active)
        if starts == 8:
            eight_started.set()
        try:
            await release.wait()
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": '{"ok":true}'}}]})
        finally:
            active -= 1
    monkeypatch.setattr("zhijian.provider.httpx.AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    provider = Provider(SimpleNamespace(api_key="test-only-not-a-real-key", ai_base_url="https://api.deepseek.com"))
    tasks = [asyncio.create_task(provider.json(prompt="JSON并发测试", model="deepseek-flash", system="测试", evidence_dir=tmp_path, name=f"cap-{i}")) for i in range(9)]
    try:
        await asyncio.wait_for(eight_started.wait(), timeout=2)
        assert peak == 8 and starts == 8
    finally:
        release.set()
        await asyncio.gather(*tasks)
    assert starts == 9
    assert peak == 8
