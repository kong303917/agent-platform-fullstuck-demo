import os
from dotenv import load_dotenv
from supabase import create_client, Client

# 加载 .env 文件中的环境变量
load_dotenv()

SUPABASE_URL: str | None = os.getenv("SUPABASE_URL")
SUPABASE_KEY: str | None = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("请确保在 .env 文件中设置了 SUPABASE_URL 和 SUPABASE_KEY。")

# 创建 Supabase 客户端实例
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_supabase_client() -> Client:
    """获取 Supabase 客户端实例的便捷函数，可用作 FastAPI 的依赖项"""
    return supabase
