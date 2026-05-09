from celery import Celery
import os
from dotenv import load_dotenv
from urllib.parse import quote

# 加载 .env 文件
load_dotenv()

# 从独立的环境变量安全构建 Redis URL（避免密码中特殊字符导致解析出错）
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = os.getenv("REDIS_PORT", "6379")
REDIS_USERNAME = os.getenv("REDIS_USERNAME", "")
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

# 对密码进行 URL 编码，确保 @ 等特殊字符被正确转义
encoded_password = quote(REDIS_PASSWORD, safe="")
if REDIS_USERNAME:
    REDIS_URL = f"redis://{REDIS_USERNAME}:{encoded_password}@{REDIS_HOST}:{REDIS_PORT}/0"
else:
    REDIS_URL = f"redis://:{encoded_password}@{REDIS_HOST}:{REDIS_PORT}/0"

celery_app = Celery(
    "agent_tasks",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["tasks"]
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
)
