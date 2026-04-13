---
name: api-endpoint-with-validation
description: Build a REST API endpoint with input validation, error handling, and typed responses
source_session: c3d4e5f6-a7b8-9012-cdef-123456789012
source_agent: claude-code
created: 2026-04-11
tags:
  - api
  - validation
  - typescript
---

# API Endpoint with Validation

## When to use
When building a new API route that accepts user input. Applies to Next.js API routes, Express handlers, or any HTTP endpoint that processes request bodies or query params.

## Steps
1. Define the input schema with Zod (or the project's validation library)
2. Create the route handler with proper HTTP method check
3. Parse and validate input at the boundary — fail fast with 400 on bad input
4. Implement the business logic with typed, validated data
5. Return consistent response shapes: `{ data }` on success, `{ error }` on failure
6. Add a test that covers: valid input, missing fields, wrong types, edge cases

## Example
User: "Add a POST /api/exercises endpoint"
Agent: Defines Zod schema for `{ name: string, muscleGroup: string, equipment?: string }`. Creates route handler, validates body, inserts to DB, returns `{ data: exercise }` with 201. Adds test for valid create, missing name (400), and duplicate name (409).

## Key decisions
- Validate at the boundary, trust internally — no re-validation in service layers
- Return 400 with specific field errors, not generic "invalid input"
- Use the same response shape everywhere so clients can parse predictably
- Write the test before the implementation to catch missing validations
