# Agent Platform Backend

This is the FastAPI backend for the Agent Platform, managed using `uv`.

## 📦 安装与环境设置

本项目使用 [uv](https://github.com/astral-sh/uv) 作为包管理工具，它是目前最快、最轻量的 Python 包管理器。

### 1. 安装依赖
如果你已经安装了 `uv`，只需在 `backend` 目录下执行以下命令，它会自动创建虚拟环境并安装所有锁定在 `uv.lock` 中的依赖：
```bash
uv sync
```
*如果你还没安装 `uv`，可以使用 `pip install uv` 或 `curl -LsSf https://astral.sh/uv/install.sh | sh` 进行安装。*

### 2. 激活虚拟环境
`uv sync` 会在当前目录下创建一个名为 `.venv` 的虚拟环境。在运行项目前，你需要先激活它：
- **Mac / Linux:**
  ```bash
  source .venv/bin/activate
  ```
- **Windows:**
  ```bash
  .venv\Scripts\activate
  ```

### 3. 运行服务
最简单且不容易出错的方式是使用 `uv run` 命令，它会自动为您使用虚拟环境中的依赖，无需手动激活环境：

- 启动 FastAPI 主服务：
  ```bash
  uv run uvicorn main:app --reload
  ```
- 启动 Celery Worker（需确保 Redis 可用及 .env 已配置）：
  ```bash
  uv run celery -A celery_app worker --loglevel=info
  ```
