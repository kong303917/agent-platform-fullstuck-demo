"""测试 Redis Cloud 连接是否正常"""
import redis
from dotenv import load_dotenv
import os

load_dotenv()

host = os.getenv("REDIS_HOST")
port = int(os.getenv("REDIS_PORT", "6379"))
username = os.getenv("REDIS_USERNAME")
password = os.getenv("REDIS_PASSWORD")

print(f"Host: {host}")
print(f"Port: {port}")
print(f"Username: {username}")
print(f"Password: {password}")

try:
    r = redis.Redis(
        host=host,
        port=port,
        decode_responses=True,
        username=username,
        password=password,
    )
    pong = r.ping()
    print(f"\n✅ 连接成功! PING -> {pong}")
    
    r.set("test_key", "hello_agent_platform")
    val = r.get("test_key")
    print(f"✅ 读写测试通过: test_key = {val}")
    r.delete("test_key")
except Exception as e:
    print(f"\n❌ 连接失败: {e}")
