# Agent Workspace documents

Agent Workspace (AW) lets you manage the work of your AI agents from anywhere. Install it on your laptop. Add an optional 24/7 remote device, and the agents keep working and learning while your laptop is closed. Your data are open files on your own devices, and a built-in sync engine keeps the devices in step.

| Document | Reader | Content |
|---|---|---|
| [principles.md](principles.md) | Everyone, humans and agents | The 9 principles and the design test. The source of truth for all other documents. |
| [decisions/](decisions/) | Product owner, system architects | Accepted decision records: [phases](decisions/2026-11-22-phases.md), [devices and sync](decisions/2026-11-22-device-sync.md), [task model](decisions/2026-11-22-task-model.md), [modules and plugins](decisions/2026-11-22-modules.md), [relay transport](decisions/2026-11-22-relay-transport.md) (phase 2), [repository layout](decisions/2026-11-23-repo-layout.md), [manual move](decisions/2026-11-23-manual-move.md), [agent pushes updates](decisions/2026-11-25-agent-pushes-updates.md). |
| [workflow.md](workflow.md) | Product owner, architects, implementers, coding agents | The work process step by step: task fields, stages, the gate table, delivery, continuity, the `aw` commands, the files. |
| [prd.md](prd.md) | Stakeholders, product manager, designers | Problem, goals, users, concepts, requirements per phase, release plan, decisions for the owner. |
| [architecture.md](architecture.md) | System architects, maintainers | The target architecture for all phases: devices, data model, ownership rules, sync transports, continuity, knowledge, interfaces, decisions (ADRs). |
| [phase-1.md](phase-1.md) | System architects, maintainers, contributors | What phase 1 builds: data layout, built-in Syncthing, pairing, push, phone scope, repository layout, what phase 2 adds. |
| [design.md](design.md) | Designers, contributors, coding agents | The desktop design system: tokens, type, spacing, components, the macOS window, keyboard and accessibility. |
| [tech-stack.md](tech-stack.md) | System architects, maintainers, contributors | Technology choices per phase, the library list per area, versions, costs, rejected options. |
| [feasibility.md](feasibility.md) | Stakeholders | Can AW work as planned? A short answer in plain language. |
| [feasibility-details.md](feasibility-details.md) | System architects, maintainers | Each claim with its verdict, evidence, sources and spike results. |
| [engineering-rules.md](engineering-rules.md) | Contributors, coding agents | Rules for code, tests, security, pull requests and releases. |

Read in this order: `principles.md`, `decisions/`, `workflow.md`, `prd.md`, `architecture.md`, `phase-1.md`.

All documents use ASD-STE100 (simplified technical English).
