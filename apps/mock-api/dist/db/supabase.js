import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
/**
 * Публичный клиент Supabase (для клиентских и анонимных операций).
 */
export const supabase = config.supabaseUrl && config.supabaseAnonKey
    ? createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;
/**
 * Сервисный (Admin) клиент Supabase (с обходом Row Level Security при необходимости).
 */
export const supabaseAdmin = config.supabaseUrl && config.supabaseSecretKey
    ? createClient(config.supabaseUrl, config.supabaseSecretKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    })
    : null;
