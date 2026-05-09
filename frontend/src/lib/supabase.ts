import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// 为了防止开发模式下因为热更新造成多个客户端实例，在这里通常创建单例
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
