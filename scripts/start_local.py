#!/usr/bin/env python3
"""Start this project's two local processes; never replace an occupied port."""
from pathlib import Path
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'data/runtime'


def occupied(port):
    with socket.socket() as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    os.chmod(RUNTIME, 0o700)
    config = ROOT / '.env'
    if not config.exists():
        sys.exit('请先复制 .env.example 为 .env，填写本机数据库与DeepSeek配置。')
    processes = [
        ('server', 8787, ROOT / 'server', [str(ROOT / '.venv/bin/python'), '-m', 'uvicorn', 'zhijian.app:app', '--host', '127.0.0.1', '--port', '8787']),
        ('web', 5178, ROOT / 'web', ['npm', 'run', 'dev']),
    ]
    launched = []
    for name, port, cwd, cmd in processes:
        pid_path = RUNTIME / (name + '.pid')
        if occupied(port):
            if pid_path.exists():
                print(f'{name}: port {port} already running; left unchanged')
                continue
            sys.exit(f'127.0.0.1:{port} 已被其他进程占用；未停止或替换它。')
        log = (RUNTIME / (name + '.log')).open('ab')
        proc = subprocess.Popen(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        log.close()
        pid_path.write_text(str(proc.pid))
        launched.append((name, port, proc))
    deadline = time.monotonic() + 25
    for name, port, proc in launched:
        while time.monotonic() < deadline and not occupied(port) and proc.poll() is None:
            time.sleep(0.25)
        if proc.poll() is not None or not occupied(port):
            sys.exit(f'{name} 启动失败，请查看 data/runtime/{name}.log（不会打印密钥）。')
    print('学习页面：http://127.0.0.1:5178')
    try:
        with urllib.request.urlopen('http://127.0.0.1:8787/api/status', timeout=4) as r:
            status = json.load(r)
        print('数据库：' + ('已连接' if status.get('dbReady') else '尚未连接'))
        print('DeepSeek：' + ('已配置，需真实调用验证' if status.get('aiConfigured') else '未配置密钥；不会返回模拟讲义'))
    except Exception:
        print('服务健康状态尚未返回，请查看本地服务日志。')


if __name__ == '__main__':
    main()
