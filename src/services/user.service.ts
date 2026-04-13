import { supabase } from '../db/client';
import type { DbUser } from '../db/types';

interface CreateUserParams {
  tg_id: number;
  username: string | null;
}

export const userService = {
  /** Returns existing user or creates one if not found. */
  async getOrCreate(params: CreateUserParams): Promise<DbUser> {
    const { tg_id, username } = params;

    // Try to fetch existing user
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('tg_id', tg_id)
      .single();

    if (existing) {
      // Keep username in sync
      if (existing.username !== username) {
        await supabase.from('users').update({ username }).eq('tg_id', tg_id);
        return { ...existing, username };
      }
      return existing as DbUser;
    }

    // Create new user — start_date defaults to today in the DB
    const { data: created, error } = await supabase
      .from('users')
      .insert({ tg_id, username })
      .select('*')
      .single();

    if (error || !created) {
      throw new Error(`Failed to create user: ${error?.message}`);
    }

    return created as DbUser;
  },

  async getByTgId(tgId: number): Promise<DbUser | null> {
    const { data } = await supabase.from('users').select('*').eq('tg_id', tgId).single();
    return (data as DbUser) ?? null;
  },

  async getAllUsers(): Promise<DbUser[]> {
    const { data } = await supabase.from('users').select('*');
    return (data as DbUser[]) ?? [];
  },
};
