export interface AgentEvent {
  schema_version: "0.1";
  event_id: string;
  run_id: string;
  ts: string;
  type: string;
  agent_name: string;
  attrs: Record<string, unknown>;
}

export interface SkillCreatedEvent extends AgentEvent {
  type: "skill.created";
  attrs: {
    source_session: string;
    source_agent: string;
    skill_name: string;
    skill_path: string;
    token_cost_input: number;
    token_cost_output: number;
    distill_mode: "llm" | "template";
  };
}
