---
description: "Create or update a Runout agent, prompt, or skill via the Agent Developer: pick the right primitive (.github/agents/*.agent.md, .github/prompts/*.prompt.md, .github/skills/<name>/SKILL.md), write valid frontmatter with a keyword-rich description, and register new agents with the Project Manager. Triggers: 'create an agent', 'new agent', 'agent for X', 'build an agent', 'add a prompt', 'prompt file', 'create/write a skill', 'SKILL.md', 'agent customization', 'add to the team', 'new slash command', 'fix my agent/prompt/skill'."
name: "Create agent / prompt / skill"
argument-hint: "What to create (agent, prompt, or skill) and its purpose (e.g. 'an agent for reviewing CSS', 'a prompt to add a catalog kind', 'a skill for the scanner')..."
agent: "Agent Developer"
---
Create or update a Runout customization file — an agent, a prompt, or a skill
— through the Agent Developer. Follow the `agent-customization` skill and the
existing conventions in `.github/agents/`, `.github/prompts/`, and
`.github/skills/`.

## Steps
1. Read the `agent-customization` skill and the existing customization files
   so the new file matches Runout's style and structure.
2. Clarify requirements: what it's for, when it should trigger, who invokes
   it, and any assets (scripts / templates / references) it needs.
3. Pick the right primitive:
   - **Agent** (`.github/agents/*.agent.md`) — a persona with a single role,
     minimal tools, and a keyword-rich `description`.
   - **Prompt** (`.github/prompts/*.prompt.md`) — a single focused task, run
     from `/`; route it with `agent: "<Name>"`.
   - **Skill** (`.github/skills/<name>/SKILL.md`) — an on-demand workflow with
     bundled assets; `name` must match the folder name exactly.
4. Write the file: valid YAML frontmatter between `---` markers, `name`
   matches the file/folder, `description` lists real trigger phrases, and an
   `argument-hint` guides the input.
5. Validate: correct location, YAML parses, trigger words are discoverable,
   and (for prompts) the `agent:` route targets a real agent. If it's a new
   agent, register it in `project-manager.agent.md` (`agents:` list + a
   routing line) so the Project Manager can delegate to it.
6. Make sure the work sits on a feature branch (see the `feature-branching`
   skill), then report.

## Deliverables
- The file(s) created or edited.
- The primitive chosen and why.
- The trigger phrases added, and any Project Manager roster change.
