-- ============================================================
-- Agent Platform — Supabase 数据库迁移脚本
-- 
-- 执行方式: 在 Supabase Dashboard → SQL Editor 中运行
-- 包含:
--   1. workflows       — 画布图结构
--   2. prompts         — Prompt 模板 (当前版本)
--   3. prompt_versions — Prompt 版本历史
--   4. executions      — 执行日志
--   + 触发器、索引、RLS 策略、清理函数
-- ============================================================


-- ============================================================
-- 1. workflows 表 — 保存画布图结构
-- ============================================================
CREATE TABLE IF NOT EXISTS workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL DEFAULT 'Untitled Workflow',
    description TEXT DEFAULT '',
    
    -- React Flow 的 nodes + edges JSON
    -- 示例: {"nodes": [...], "edges": [...]}
    graph_data  JSONB NOT NULL DEFAULT '{"nodes": [], "edges": []}',
    
    -- Agent 配置 (model, agent_name 等)
    config      JSONB DEFAULT '{}',
    
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE workflows IS '保存用户在 React Flow 画布上编排的图结构 JSON';
COMMENT ON COLUMN workflows.graph_data IS 'React Flow 节点和边的完整 JSON，包含 nodes 和 edges 数组';
COMMENT ON COLUMN workflows.config IS 'Agent 配置，如 model 名称、agent_name 等';

-- 索引：按更新时间排序查询
CREATE INDEX IF NOT EXISTS idx_workflows_updated_at ON workflows (updated_at DESC);


-- ============================================================
-- 2. prompts 表 — 保存 Prompt 模板 (当前版本)
-- ============================================================
CREATE TABLE IF NOT EXISTS prompts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL DEFAULT 'Untitled Prompt',
    
    -- Tiptap 编辑器的 HTML 内容
    content_html    TEXT NOT NULL DEFAULT '',
    
    -- 纯文本版本（用于后端直接使用，不含 HTML 标签）
    content_text    TEXT DEFAULT '',
    
    -- 提取的模板变量列表，如 ["context", "user_query"]
    variables       JSONB DEFAULT '[]',
    
    -- 当前版本号，从 1 开始递增
    current_version INTEGER NOT NULL DEFAULT 1,
    
    -- 可选关联到某个 workflow
    workflow_id     UUID REFERENCES workflows(id) ON DELETE SET NULL,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE prompts IS '保存 Tiptap 编辑器中的 Prompt 模板，保留当前版本';
COMMENT ON COLUMN prompts.current_version IS '当前版本号，每次更新自动递增';
COMMENT ON COLUMN prompts.variables IS '从 Prompt 中提取的模板变量名列表';

CREATE INDEX IF NOT EXISTS idx_prompts_workflow_id ON prompts (workflow_id);
CREATE INDEX IF NOT EXISTS idx_prompts_updated_at ON prompts (updated_at DESC);


-- ============================================================
-- 3. prompt_versions 表 — Prompt 版本历史
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 关联的 prompt
    prompt_id       UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    
    -- 版本号
    version         INTEGER NOT NULL,
    
    -- 该版本的内容快照
    content_html    TEXT NOT NULL DEFAULT '',
    content_text    TEXT DEFAULT '',
    variables       JSONB DEFAULT '[]',
    
    -- 变更摘要（可选）
    change_summary  TEXT DEFAULT '',
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- 同一个 prompt 的 version 不能重复
    UNIQUE(prompt_id, version)
);

COMMENT ON TABLE prompt_versions IS 'Prompt 版本历史，每次修改前自动保存旧版本快照';
COMMENT ON COLUMN prompt_versions.version IS '版本号，与 prompts.current_version 对应';
COMMENT ON COLUMN prompt_versions.change_summary IS '版本变更摘要，描述本次修改内容';

CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions (prompt_id, version DESC);


-- ============================================================
-- 4. executions 表 — 执行日志
-- ============================================================
CREATE TABLE IF NOT EXISTS executions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- 关联的 workflow（可选，允许临时执行不关联）
    workflow_id     UUID REFERENCES workflows(id) ON DELETE SET NULL,
    
    -- Celery 任务 ID（用于关联 SSE 频道）
    task_id         TEXT NOT NULL DEFAULT '',
    
    -- 执行状态: pending | running | success | error
    status          TEXT NOT NULL DEFAULT 'pending',
    
    -- 用户输入
    user_input      TEXT DEFAULT '',
    
    -- 执行时的图结构快照（防止 workflow 后续修改影响历史记录）
    graph_snapshot  JSONB DEFAULT '{}',
    
    -- 执行结果（final_output 等）
    result          JSONB DEFAULT '{}',
    
    -- 中间步骤日志数组
    steps           JSONB DEFAULT '[]',
    
    -- 工具调用结果数组
    tool_results    JSONB DEFAULT '[]',
    
    -- 错误信息
    error_message   TEXT DEFAULT '',
    
    -- 总耗时 (毫秒)
    duration_ms     INTEGER DEFAULT 0,
    
    -- 执行时的 Agent 配置
    config          JSONB DEFAULT '{}',
    
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE executions IS '每次 Agent 执行的完整日志，包含输入、输出、中间步骤和耗时';
COMMENT ON COLUMN executions.graph_snapshot IS '执行时的图结构快照，冻结当时的 nodes/edges 状态';
COMMENT ON COLUMN executions.duration_ms IS '从开始到完成的总耗时，单位毫秒';

CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions (workflow_id);
CREATE INDEX IF NOT EXISTS idx_executions_task_id ON executions (task_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions (status);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions (created_at DESC);


-- ============================================================
-- 5. updated_at 自动更新触发器
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_prompts_updated_at
    BEFORE UPDATE ON prompts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 6. Prompt 版本快照触发器
--    在 prompts 表 UPDATE 时，自动将旧版本保存到 prompt_versions
-- ============================================================
CREATE OR REPLACE FUNCTION snapshot_prompt_version()
RETURNS TRIGGER AS $$
BEGIN
    -- 仅当内容实际发生变化时才创建版本快照
    IF OLD.content_html IS DISTINCT FROM NEW.content_html
       OR OLD.content_text IS DISTINCT FROM NEW.content_text THEN
        
        -- 将旧版本保存到 prompt_versions
        INSERT INTO prompt_versions (prompt_id, version, content_html, content_text, variables, change_summary)
        VALUES (OLD.id, OLD.current_version, OLD.content_html, OLD.content_text, OLD.variables, '');
        
        -- 递增版本号
        NEW.current_version = OLD.current_version + 1;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prompt_version_snapshot
    BEFORE UPDATE ON prompts
    FOR EACH ROW EXECUTE FUNCTION snapshot_prompt_version();


-- ============================================================
-- 7. 执行记录自动清理函数
--    调用示例: SELECT cleanup_old_executions(30);  -- 清理 30 天前的记录
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_old_executions(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM executions
    WHERE created_at < now() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_executions IS '清理超过指定天数的执行记录，返回删除的记录数';


-- ============================================================
-- 8. RLS 策略 (当前为公开访问模式)
-- ============================================================
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions ENABLE ROW LEVEL SECURITY;

-- 公开读写策略（无认证模式）
CREATE POLICY "Allow all access to workflows" ON workflows
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to prompts" ON prompts
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to prompt_versions" ON prompt_versions
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to executions" ON executions
    FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 验证：列出所有创建的表
-- ============================================================
SELECT table_name, table_type 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('workflows', 'prompts', 'prompt_versions', 'executions')
ORDER BY table_name;
