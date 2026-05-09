/**
 * Supabase 业务 API 封装
 *
 * 基于 supabase client 提供 workflows / prompts / executions 的
 * 前端 CRUD 操作。
 */

import { supabase } from './supabase'

// ============================================================
// Types
// ============================================================

export interface Workflow {
  id: string
  name: string
  description: string
  graph_data: {
    nodes: unknown[]
    edges: unknown[]
  }
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Prompt {
  id: string
  name: string
  content_html: string
  content_text: string
  variables: string[]
  current_version: number
  workflow_id: string | null
  created_at: string
  updated_at: string
}

export interface PromptVersion {
  id: string
  prompt_id: string
  version: number
  content_html: string
  content_text: string
  variables: string[]
  change_summary: string
  created_at: string
}

export interface Execution {
  id: string
  workflow_id: string | null
  task_id: string
  status: 'pending' | 'running' | 'success' | 'error'
  user_input: string
  graph_snapshot: Record<string, unknown>
  result: Record<string, unknown>
  steps: string[]
  tool_results: { tool: string; result: string }[]
  error_message: string
  duration_ms: number
  config: Record<string, unknown>
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// ============================================================
// Workflow API
// ============================================================

export const workflowApi = {
  /**
   * 列出所有 workflows
   */
  async list(limit = 50, offset = 0): Promise<Workflow[]> {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw new Error(`Failed to list workflows: ${error.message}`)
    return data ?? []
  },

  /**
   * 获取单个 workflow
   */
  async get(id: string): Promise<Workflow | null> {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null // Not found
      throw new Error(`Failed to get workflow: ${error.message}`)
    }
    return data
  },

  /**
   * 保存 workflow（创建或更新）
   */
  async save(
    workflow: Partial<Workflow> & { graph_data: Workflow['graph_data'] },
    id?: string,
  ): Promise<Workflow> {
    if (id) {
      // 更新
      const { data, error } = await supabase
        .from('workflows')
        .update(workflow)
        .eq('id', id)
        .select()
        .single()

      if (error) throw new Error(`Failed to update workflow: ${error.message}`)
      return data
    } else {
      // 创建
      const { data, error } = await supabase
        .from('workflows')
        .insert(workflow)
        .select()
        .single()

      if (error) throw new Error(`Failed to create workflow: ${error.message}`)
      return data
    }
  },

  /**
   * 删除 workflow
   */
  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('workflows')
      .delete()
      .eq('id', id)

    if (error) throw new Error(`Failed to delete workflow: ${error.message}`)
  },
}

// ============================================================
// Prompt API
// ============================================================

export const promptApi = {
  /**
   * 列出 prompts
   */
  async list(workflowId?: string, limit = 50, offset = 0): Promise<Prompt[]> {
    let query = supabase
      .from('prompts')
      .select('*')
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (workflowId) {
      query = query.eq('workflow_id', workflowId)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed to list prompts: ${error.message}`)
    return data ?? []
  },

  /**
   * 获取单个 prompt
   */
  async get(id: string): Promise<Prompt | null> {
    const { data, error } = await supabase
      .from('prompts')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`Failed to get prompt: ${error.message}`)
    }
    return data
  },

  /**
   * 保存 prompt（创建或更新）
   */
  async save(
    prompt: Partial<Prompt>,
    id?: string,
  ): Promise<Prompt> {
    if (id) {
      const { data, error } = await supabase
        .from('prompts')
        .update(prompt)
        .eq('id', id)
        .select()
        .single()

      if (error) throw new Error(`Failed to update prompt: ${error.message}`)
      return data
    } else {
      const { data, error } = await supabase
        .from('prompts')
        .insert(prompt)
        .select()
        .single()

      if (error) throw new Error(`Failed to create prompt: ${error.message}`)
      return data
    }
  },

  /**
   * 删除 prompt
   */
  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('prompts')
      .delete()
      .eq('id', id)

    if (error) throw new Error(`Failed to delete prompt: ${error.message}`)
  },

  /**
   * 获取 prompt 的版本历史
   */
  async listVersions(promptId: string): Promise<PromptVersion[]> {
    const { data, error } = await supabase
      .from('prompt_versions')
      .select('*')
      .eq('prompt_id', promptId)
      .order('version', { ascending: false })

    if (error) throw new Error(`Failed to list prompt versions: ${error.message}`)
    return data ?? []
  },

  /**
   * 获取特定版本
   */
  async getVersion(promptId: string, version: number): Promise<PromptVersion | null> {
    const { data, error } = await supabase
      .from('prompt_versions')
      .select('*')
      .eq('prompt_id', promptId)
      .eq('version', version)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`Failed to get prompt version: ${error.message}`)
    }
    return data
  },

  /**
   * 恢复到指定版本
   */
  async restoreVersion(promptId: string, version: number): Promise<Prompt> {
    const versionData = await this.getVersion(promptId, version)
    if (!versionData) {
      throw new Error(`Version ${version} not found for prompt ${promptId}`)
    }

    return this.save(
      {
        content_html: versionData.content_html,
        content_text: versionData.content_text,
        variables: versionData.variables,
      },
      promptId,
    )
  },
}

// ============================================================
// Execution API
// ============================================================

export const executionApi = {
  /**
   * 列出执行记录
   */
  async list(
    options: {
      workflowId?: string
      status?: string
      limit?: number
      offset?: number
    } = {},
  ): Promise<Execution[]> {
    const { workflowId, status, limit = 50, offset = 0 } = options

    let query = supabase
      .from('executions')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (workflowId) {
      query = query.eq('workflow_id', workflowId)
    }
    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed to list executions: ${error.message}`)
    return data ?? []
  },

  /**
   * 获取单条执行详情
   */
  async get(id: string): Promise<Execution | null> {
    const { data, error } = await supabase
      .from('executions')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`Failed to get execution: ${error.message}`)
    }
    return data
  },

  /**
   * 根据 Celery task_id 获取执行记录
   */
  async getByTaskId(taskId: string): Promise<Execution | null> {
    const { data, error } = await supabase
      .from('executions')
      .select('*')
      .eq('task_id', taskId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`Failed to get execution by task_id: ${error.message}`)
    }
    return data
  },
}
