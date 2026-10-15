#!/usr/bin/env python3
"""Exchange Codex-authored teaching data with the local API; never call a model."""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


def api(base_url, path, payload=None):
    parsed = urlsplit(base_url)
    if (parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}):
        raise ValueError("--base-url 必须是本机 localhost 或回环地址，不接受凭据、路径或外部服务")
    raw = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    request = Request(base_url.rstrip("/") + path, data=raw, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        try:
            detail = json.load(exc).get("detail", "请求被拒绝")
        except (ValueError, AttributeError):
            detail = "请求被拒绝"
        raise ValueError(f"本机API返回{exc.code}：{detail}") from None
    except (URLError, TimeoutError):
        raise ValueError("本机学习服务暂不可用，请先启动服务后重试") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description="导出当前教案上下文，导入 Codex 制作的纯数据教学资源。无需密钥，不调用 AI。")
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export-context", help="导出当前原题、已核验教案及模板约束")
    export.add_argument("--base-url", default=argparse.SUPPRESS)
    export.add_argument("--question-id", required=True)
    export.add_argument("--part-id", default="main")
    export.add_argument("--out", type=Path, required=True)
    importing = commands.add_parser("import", help="导入纯JSON资源包；不接受脚本或HTML")
    importing.add_argument("--base-url", default=argparse.SUPPRESS)
    importing.add_argument("path", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "export-context":
            path = "/api/questions/" + quote(args.question_id, safe="")
            lesson = api(args.base_url, path + "/lesson").get("lesson")
            if not lesson or lesson.get("status") != "ready":
                raise ValueError("当前题目还没有已核验的就绪教案，未导出制作上下文")
            query = urlencode({"lessonVersion": lesson["lessonVersion"], "partId": args.part_id})
            context = api(args.base_url, path + "/teaching-context?" + query)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w") as output:
                json.dump(context, output, ensure_ascii=False, indent=2)
            args.out.chmod(0o600)
            print("已导出当前教学上下文；请由 Codex 制作纯数据资源包后导入。")
        else:
            try:
                pack = json.loads(args.path.read_text())
            except (OSError, ValueError):
                raise ValueError("资源包文件不可读或不是合法JSON，未导入") from None
            target = pack.get("target") if isinstance(pack, dict) else None
            if not isinstance(target, dict) or not isinstance(target.get("questionId"), str) or not target["questionId"]:
                raise ValueError("资源包缺少有效 target.questionId，未导入")
            result = api(args.base_url, "/api/questions/" + quote(target["questionId"], safe="") + "/motion-resources", pack)
            print(json.dumps({"motionPackId": result["motionPack"]["id"], "validation": "Codex制作；本机结构校验通过；未冒充教师审核"}, ensure_ascii=False))
        return 0
    except (ValueError, KeyError, OSError) as exc:
        print("教学资源操作失败：" + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
