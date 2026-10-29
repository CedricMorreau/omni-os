# Crew and Conductor

Roles live in `crew/*.md` (frontmatter + charter, edit freely, read on every run):

| Role | For |
| --- | --- |
| conductor | Front agent in #conductor. Delegates, never does the grind or writes code |
| researcher | Research, audits, answers to client questions, HTML reports |
| store-ops | Shopify store work, PSI/SEO, translations, imports |
| builder | Code in a repo channel, own worktree, opens PRs |
| inbox | Mail, calendar, Productive, Notion, Slack drafts. Never sends on its own |
| ticket | One client ticket through ten stages, research to closing. Gets the `omni-ticket` MCP. Gates (plan, client, go) need the user's own words |

The frontmatter sets each role's model and, for conductor and inbox, its default channel. The conductor is pinned to Sonnet 5.5 (status answers are light work) and the ticket role to Opus 5.5; a saved #conductor channel default still wins (see [Auto](harnesses.md#auto)). Other roles default to `model: auto`, so each delegated brief gets the model it needs. Pin a model in a role's frontmatter to opt it out.

The conductor's `omni` MCP (`apps/mcp/omni.ts`) exposes `tickets`, `create_ticket`, `list_channels`, `list_crew`, `list_harnesses`, `delegate`, `delegate_team`, `message_thread`, `mark_thread_done`, `switch_thread_run`, `continue_thread`, `get_thread`, `list_threads`, `search_history`, `list_published_artifacts`, `check_artifact_comments`, `list_devices`, `hand_off_thread`, `send_to_grok_bot`, `read_referenced_thread`, `watch_pr`, `list_automation_deliveries`, `retry_delivery`, `skip_delivery`, `worktree_storage`, `tool_failures`, `triage_tool_failure`, `note_tool_failure_recovery`. A delegated thread runs in the target channel; when it finishes, its reply is posted to the conductor as a crew report (tagged with the task id) and the conductor is woken to relay it. In Running, Recent threads and the Conductor's channel list, delegated children nest under their parent (expand/collapse, status, destination channel, and a link back to the parent); the same nesting shows on phone Activity and Channels. Any crew role whose frontmatter includes the `omni` MCP (Claude Code, Codex or Cursor Agent) also gets a short Thread delegation section in its system prompt: use `delegate` or `delegate_team`, call `list_crew` and `list_channels` for valid ids, and write each brief so the child thread stands alone.

## Roles per stage

The Roles screen (sidebar, or Settings on the phone) lists the ten ticket stages with the roles for each. A role is instructions plus skills plus the stages it fits. Your own roles are saved in `memory/roles/` of the Claude Code home memory folder and override a shipped role with the same id. At the start of a stage the ticket thread proposes one of that stage's roles, takes it on after you confirm, and uses its skills.
