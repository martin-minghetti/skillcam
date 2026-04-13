---
name: supabase-rls-setup
description: Add Row Level Security policies to Supabase tables with proper auth checks
source_session: b2c3d4e5-f6a7-8901-bcde-f12345678901
source_agent: claude-code
created: 2026-04-09
tags:
  - supabase
  - security
  - database
---

# Supabase RLS Setup

## When to use
When creating or modifying Supabase tables that store user data. Apply immediately after creating any table — never leave a table without RLS in production.

## Steps
1. Enable RLS on the table: `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;`
2. Create a SELECT policy for authenticated users to read their own rows:
   ```sql
   CREATE POLICY "Users can read own rows" ON <table>
     FOR SELECT USING (auth.uid() = user_id);
   ```
3. Create INSERT policy requiring the user_id matches auth:
   ```sql
   CREATE POLICY "Users can insert own rows" ON <table>
     FOR INSERT WITH CHECK (auth.uid() = user_id);
   ```
4. Create UPDATE and DELETE policies following the same pattern
5. Test with two different users to confirm isolation
6. Verify that unauthenticated access returns empty results

## Example
User: "Add a workouts table to the gym tracker"
Agent: Creates migration with table + RLS policies. Tests by inserting a row as user A, verifying user B can't see it. Confirms anon access returns 0 rows.

## Key decisions
- Always use `auth.uid()` — never trust client-provided user IDs
- Enable RLS before inserting any data, not after
- Service role key bypasses RLS — only use it in trusted server-side code
- Test isolation between users, not just "can the owner see it"
