# Agent Workspace — Feasibility summary

| Item | Value |
|---|---|
| Document | Feasibility summary |
| Date | 2026-11-22 |
| Readers | Stakeholders and the product owner |
| Details | [feasibility-details.md](feasibility-details.md): tests, verdicts, evidence and sources. Section 10 has the tests on real devices. |

We checked if AW can keep the promises of [principles.md](principles.md) in 3 phases ([decisions/2026-11-22-phases.md](decisions/2026-11-22-phases.md)).

First we read the official documents of Anthropic, Syncthing, Google and Android, and the source of the maintained Syncthing Android app. We ran Syncthing tests with 3 copies of Syncthing on one Mac. Then we tested on real devices: a MacBook (local), a Linux box that runs 24/7 (remote) and an Android 14 emulator (mobile). A real Claude Code session ran with the AW plugin. A design review checked [workflow.md](workflow.md) against the principles.

## Short answer
Yes. Phase 1 is feasible. The tests on real devices found no reason to change the architecture.
- AW has its own built-in sync engine (Syncthing) on the laptop, the remote device and the phone. You never install a Syncthing app. It ran on all 3 device types.
- A change reaches the other device in about 2 s, and in about 1.3 s when AW tells the engine which file it wrote.
- Devices get no conflicts when each device writes only its own files. In a test, 600 log lines from 2 devices gave 0 conflicts and 0 lost lines.
- A real agent asked a question, got the answer from the phone, and finished the task. After a forced stop, it continued the same conversation.
- The tests gave 22 design changes. The most important one: the task thread keeps every message between you and the agents word for word (principle 8). All 22 are in the design before implementation starts.
- Phase 1 needs no relay, no cloud storage and no AW service. AW itself costs 0 USD. Claude is the main cost.
- Nine items are not proven yet. The main ones: push to a real phone, a real mobile network and the battery use of a real phone.

## Phase 1
### 1. Can AW run its own sync without a Syncthing app?
- **Answer:** Yes, on the laptop, on the remote device and on the phone. We tested a Mac, a Linux box and an Android emulator.
- **Why:** AW ships the official signed Syncthing program and controls it fully. In the test, 2 devices connected in 0.3 s and shared a folder in 2.6 s. On Android, an app with the engine inside connected in 1.5 s and kept its setup after a forced stop. With the default settings, the engine used public servers and opened ports on the home router for 33 s. With AW's safe settings written first, it contacted no public server.
- **What it means for you:**
  - Sync is part of AW. AW chooses the version, the settings and when sync runs.
  - The phone syncs all the time in the background. It always shows the small notification "AW is syncing". In a test, a file arrived in about 3 s while the phone was in deep sleep mode.
  - When you set the battery use of AW to "Restricted", sync stops. AW warns you and shows how to change it.
  - The phone app with the engine is about 20 MB to download. The engine uses about 50 MB of memory.
  - AW stays open source (MIT). It ships the Syncthing license and does not use the Syncthing name or logo as its brand.

### 2. Do my devices get conflicts?
- **Answer:** No, when each device writes only its own files. This is the AW design.
- **Why:** In the test, 2 devices wrote 300 log lines each at the same time. All 600 lines arrived, with 0 conflict files and equal content on both. When 2 devices change the same file, Syncthing keeps one version and saves the other as a copy. AW resolved each copy in less than 2 s, with no file left.
- **What it means for you:** AW gives each file one owner device, so copies are rare. When a copy appears, AW resolves it at once with a fixed rule: the laptop version wins over the remote and the phone. Undo uses a hidden history. AW also saves a copy of a file before it changes it, because Syncthing's own history does not keep the laptop's own edits. AW never deletes a task folder; it archives the task.

### 3. How fast does a phone answer reach the agent?
- **Answer:** In about 2 to 3 s when both devices are online on the same network. When the device that runs the task is offline, the answer waits until it is online.
- **Why:** From the phone emulator to the Linux box, a file arrived in 2.3 s, or 1.3 s when AW told the engine which file it wrote. AW then typed the answer into the session in 0.3 to 0.4 s. Between the Mac and the Linux box, a change took 2.1 to 2.4 s on the home network and on Tailscale. A file that changes very often can lag up to 8 s. We did not test a real mobile network.
- **What it means for you:** The phone shows "Answer sent, waiting for MacBook Pro" until the agent takes it. After a restart of the remote device, the phone took 2 to 16 s to connect again, so AW retries every 5 s while the app is open. With a 24/7 remote device, the device that runs the task is almost always online. Phase 2 storage removes the wait.

### 4. Do I get notifications with no relay?
- **Answer:** Yes, very likely. We did not test push yet.
- **Why:** The device that owns the gate sends an encrypted push through Google's push service, or through your own ntfy server. Google sees only encrypted data. Google does not document this path well, so it can change.
- **What it means for you:** Push is required in phase 1. Each gate push shows a notification with a short preview. Then the phone syncs. Without Google Play services, use ntfy. A push test on a real phone must pass before the phone app is released.

### 5. What works with only my laptop?
- **Answer:** All of phase 1, while the laptop is on.
- **Why:** The agents, the sessions, the knowledge, the test slots and the `aw` command run on the laptop. The phone syncs directly with it.

| You have | What works |
|---|---|
| Laptop only | All of phase 1. When the laptop sleeps, tasks show "Paused: MacBook Pro is asleep" and continue when it wakes. |
| Laptop and phone | The same. The phone works as a remote control while the laptop is on. Answers from the phone wait while the laptop sleeps. |
| Laptop, 24/7 remote device and phone | The agents keep working on the remote device while the laptop is closed. The phone syncs with the remote device. |

AW never fails silently. Each wait shows the cause, for example "3 changes not synced to MacBook Pro (offline)".

### 6. Can my agents keep working on a remote device while the laptop is closed?
- **Answer:** Yes, when you add a 24/7 remote device, for example a cloud VM, a home PC or a Mac mini.
- **Why:** In the test, the agent ran on the Linux box, and the Mac and the phone answered its questions. A laptop that wakes catches up in about 2 s. While the laptop was frozen for 2 min, the Linux box still showed it as connected. So AW checks each device with its own heartbeat, not with the Syncthing connection.
- **What it means for you:**
  - Pair each device once with a QR code. AW connects all your devices to each other.
  - A task with no assignee waits for you to assign it. AW never assigns a task alone.
  - Only one device runs a task at a time. When a laptop wakes after its task moved, AW keeps the laptop's unpushed work as a separate branch and tells you in the thread.

### 7. Are my files open to read?
- **Answer:** Yes. Your data is plain text files on your own devices, and only your devices can read them.
- **Why:** Tasks are YAML files and logs are JSON Lines files, each with a published schema. Across networks, Syncthing uses community servers to find and connect your devices. These servers see your IP address, your device ids and the traffic volume, not your data.
- **What it means for you:** You can open, back up and move every file. To keep all traffic on your own network, turn on "LAN and Tailscale only". Credentials and test-server settings sync in a separate folder that never goes to the phone. AW removes credential values from every log line. The phone can add or replace a credential but cannot read it. The agents send your code to Anthropic, as Claude Code always does.

### 8. Does the work continue after a reboot, a crash, an update or a usage limit?
- **Answer:** Yes, after a one-time setup of each device that runs agents. A weekly limit can stop the work for days.
- **Why:** In the real test, a session stopped by force continued the same conversation, with the AW plugin loaded again. When the AW service crashed, the agent kept working. The restarted service delivered the missed answer 0.47 s after its start. Commands that the agent ran in the background kept running after the forced stop, so AW stops all processes of a session. Claude Code gives the reset time of each limit.
- **What it means for you:** The task shows, for example, "Paused: usage limit. Resumes at 15:45." At a weekly limit, AW offers 3 choices: wait, pay for extra usage, or use an API key.

### 9. Can I answer the permission questions of an agent from my phone?
- **Answer:** Yes. We tested it in a real session.
- **Why:** AW allowed and denied commands from another device. The agent saw a "deny" only as a tool error, so AW also sends your answer as your next message. Once, a simple counter approved the wrong command, so each answer now names a unique request id.
- **What it means for you:** Your rules answer the usual questions. The other questions come to your phone as a gate. "Approve command" waits 120 s, then says "no". A late "Allow" approves that exact request once.

### 10. Does each agent see my original words?
- **Answer:** Yes, after a design change.
- **Why:** In the test, the agent quoted the first message word for word with `aw thread`. But the design review found that text typed in the terminal and the plain replies of the agent did not reach the thread. Questions that the agent asks in the terminal also reached nobody.
- **What it means for you:** The device that runs the session writes every message, from you and from the agent, as raw text in the thread. A new session gets your first message and the confirmed approach word for word. A question in the terminal becomes a gate on your phone.

### 11. May I run Claude Code on my devices with my own Claude plan?
- **Answer:** Yes, for your own work. Automatic work is a grey area.
- **Why:** Anthropic's terms allow your own unmodified Claude Code with your own plan. AW never touches your login.
- **What it means for you:** You sign in on Anthropic's own page. One agent that works day and night needs more than a Pro ($20), Max ($100) or Ultra ($200) plan. On an API key, it costs about $1,200 to $2,300 per month (our estimate).

## Phase 2 and 3
These checks are from earlier rounds. AW stays at 0 USD per person in all phases.
- **Relay (phase 2):** AW uses iroh with each person's own relay. The relay is optional; LAN and Tailscale work without it. A relay needs a small server of your own. It can push "ubuntu-01 offline since 03:12".
- **Storage R2 (phase 2):** The safe-update check passed on 4 test servers. R2 is free up to 10 GB but needs a payment method. A full restore is not tested.
- **People and sharing (phase 2):** Peer links over iroh are not tested yet. Only the owner of a personal plan drives that agent.
- **Phase 3:** Google Drive storage, schedules, meetings and vector knowledge are not checked yet.

## Not proven yet
1. **Push wakes a real phone.** Check: send an encrypted push to a Pixel 9 in sleep mode through Google and through ntfy. Measure the delivery time.
2. **A real mobile network.** All tests ran on one home network, and Tailscale used a direct path. Check: a full gate answer on a phone hotspot and through a community relay.
3. **Battery use of a real phone.** The emulator gives no battery numbers. Check: measure a Pixel 9 for 24 h.
4. **Google Play policy.** Check: publish a test build with the built-in engine, the sync notification and the video that Play asks for.
5. **No answer to a permission question.** Check: let "Approve command" time out in a real session, then send a late "Allow".
6. **An Orca restart.** Check: restart Orca while an agent runs in an Orca terminal. The session must continue.
7. **The Mac app with Syncthing inside.** Check: sign and notarize the app, then run it on a clean Mac.
8. **Several days with 3 devices.** Check: a laptop that sleeps, a remote device with a real agent and a phone for 7 days. Count conflicts and lost changes.
9. **Automatic work on a personal plan.** Check: ask Anthropic for a written answer. Until then, AW resumes a session alone at most 3 times, then asks you.

## Decisions for you
The full list is in [prd.md](prd.md) section 13.
1. **D14 Built-in Syncthing.** Recommendation: ship the official program on the laptop and the remote device, and an AW build on the phone.
2. **D18 Community servers.** Recommendation: on by default, explained at setup, with the switch "LAN and Tailscale only".
3. **D12 Push.** Accepted: required in phase 1. The real-phone test (item 1 above) must pass before the phone release.
4. **D5 Automatic work on a personal plan.** AW resumes sessions alone with the limit in item 9 above. Confirm this, or require an API key.
5. **Questions from the tests.** You answered Q1 to Q5 ([decisions/2026-11-22-task-model.md](decisions/2026-11-22-task-model.md) §5). For example, a subtask starts at Ready with the approach of its parent.

## What we changed in the design because of the checks
- AW ships and controls its own sync engine on every device. It writes safe settings before the first start, so the engine never contacts the internet before your choice.
- Each device writes only its own files. Task folders use an internal id, not the key AW-12, because 2 offline devices can take the same key.
- Tasks, knowledge and secure files (credentials, test-server settings) are separate sync folders. The secure folder never goes to the phone.
- AW tells the engine about each file that it writes. "Sync now" always starts with a full check. "Synced" shows only when each device confirms it.
- AW checks if a device is alive with its own heartbeat. Only one session runs a task at a time.
- The thread keeps every message word for word. Questions in the terminal become gates. AW types an answer only when no dialog is open, and a hook confirms that it arrived.
- AW never puts your first message in a command line. It removes credential values from every log line. The agent starts to implement only after its "ready" check passes on the device that implements.
- Each gate has a timeout or a reminder.
- The phone syncs all the time with the notification "AW is syncing". It asks for no battery exemption and no location access. In a test, a file arrived in 3.1 s in deep sleep mode. If the battery test on a real phone shows a high cost, the phone syncs only for short periods after a push.
- In phase 1, the live terminal works only on the same LAN or Tailscale. From other networks, the phone shows the last snapshot. Phase 2 adds the relay.
