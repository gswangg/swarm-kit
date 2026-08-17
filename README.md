# swarm-kit

A planner/worker agent swarm that builds a repository, unattended, for days.

swarm-kit is a single JavaScript workflow for Claude Code's `Workflow` tool plus
two shell scripts. A planner reads your spec and emits waves of parallel tasks;
worker agents implement them in isolated git worktrees; a merge train integrates
finished branches — and when the merge backlog outruns the trains, a
**Thunderdome** megabatches every pending branch at once and repairs the result
with a parallel diagnosis swarm. Coordination happens entirely through artifacts
in the target repo (decision docs, a field guide, git history), so a run is
resumable after any crash, cap, or reboot.

Everything project-specific lives in one `CONFIG` block at the top of
`.claude/workflows/swarm-build.js`. There is no framework, no dependency, and no
state outside your repo's git history.

## Architecture

```
SPEC + docs/ ──▶ PLANNER (opus xhigh, read-only) — waves of ≤10 tasks + decisions
              ▼
            SCRIBE (sonnet low) — decisions/DEC-NNN.md, optional compile-checked
            constants module, field guide (≤60 lines), round-N tag on green
              ▼
task queue ─▶ N LANES × WORKER (sonnet medium) — own git worktree+branch,
              implement + test, commit                    (replan at low-water)
              ▼
            merge backlog < 12 ──▶ MERGE TRAIN (opus high): ≤6 branches,
              resolve-never-drop, ONE build+test per train
            merge backlog ≥ 12 ──▶ ★ THUNDERDOME (opus high): megabatch ALL
              pending branches, ONE validation, roll forward — never bisect;
              if red: 4 parallel DIAGNOSTICIANS (opus high, read-only)
              → 1 MEDIC (opus high) applies fixes forward on main (≤3 cycles)
              ▼
            main ──(every 4 waves)──▶ 4 REVIEW LENSES (codebase=opus;
              reports / diff-history / adversarial-execution=sonnet —
              the adversarial lens RUNS the product and attacks it, which is
              where privilege and visibility leaks actually surface)
plus: CUSTODIAN (contention & megafile decomposition) · SENTINEL (git-dir +
      disk halts) · bin/janitor.sh (worktree disk)
```

Five loops make this work, and each one earns its keep:

- **Plan-ahead waves.** The planner runs again whenever the eligible queue drops
  below `lowWater`, so lanes never idle waiting on a planning turn.
- **Worktree isolation.** Every worker gets its own checkout and branch. Workers
  never touch main, never merge, never see each other.
- **Resolve-never-drop integration.** A merge agent that hits a conflict reads
  both sides and the decision docs. Dropping a branch to make a merge easy is
  forbidden; reverting is reserved for textually irreparable merges.
- **Contention custodian.** A file that shows up in 4+ merge conflicts, or grows
  past `megafileLines`, gets queued for behavior-preserving decomposition. The
  swarm refactors its own hotspots instead of grinding against them.
- **Sentinel + convergence.** A cheap probe checks the clock, that the target's
  `.git` is still the target's `.git`, and disk headroom. Three consecutive
  planner failures declare convergence and drain cleanly rather than thrash.

## Quickstart

1. **Prepare the target repo.** It must be its own git repo, outside this one,
   with a green build skeleton, a `decisions/README.md` stating the DEC-NNN
   format, an empty `field-guide/index.md`, and a `round-0` tag. Commit your
   lockfile — workers start from bare worktrees.

2. **Edit the CONFIG block** in `.claude/workflows/swarm-build.js`: `target`,
   `wt`, `goal`, `specPaths`, `mandate`, `buildCmd`, `testCmd`, `invariants`.
   Everything below those is tuned; change it only with a reason.

3. **Copy `.env.example` to `.env`** and set `TARGET` (matching `CONFIG.target`
   — the launcher refuses to start on a mismatch) and `WT`.

4. **Validate the settings file once, interactively.** An invalid
   `.claude/settings.json` is silently skipped in headless mode, and the
   `Workflow(swarm-build)` allow rule is what keeps an unattended run from
   stalling on a permission prompt.

5. **Launch.**

   ```bash
   bin/launch.sh                    # tmux session, Remote Control, heartbeat
   bin/janitor.sh &                 # disk janitor (reads .env)
   tmux attach -t swarm
   ```

Watch the pane for ~90 seconds: confirm `HEARTBEAT-ARMED` and then the Workflow
invocation before walking away. After that, watch from anywhere:

```bash
git -C <target> log --oneline | head    # merges landing
git -C <target> tag | sort -V | tail    # round-N per green wave
```

**Resume is automatic.** The runner re-invokes the workflow from the last
`round-N` tag on any non-converged exit. Manual resume: `Workflow` args
`{startWave: N}`, or set `startWave` in CONFIG.

### The runner is self-monitoring

`bin/launch.sh` starts one *interactive* Claude session inside tmux with Remote
Control on, so you can check status or steer from the mobile app; messages sent
mid-run queue until the turn boundary and never interrupt a running workflow.
Two event sources drive it, no external process:

- The `Workflow` tool runs in the background and fires a task-notification on
  completion — a drained run resumes the moment it ends.
- A **persistent `Monitor` heartbeat**, armed by the runner itself, emits one
  line every 30 minutes. This is the retry path through usage-limit saturation:
  the monitor is a local bash process that needs no tokens to keep ticking, so a
  turn that failed for lack of tokens is simply retried by the next heartbeat.
  It also covers crashes and missed notifications.

On genuine convergence the runner stops the monitor via `TaskStop` and touches
`.swarm-complete` as the on-disk record.

## Thunderdome

Stock integration is a sequential merge train: up to `mergeTrain` branches, one
build+test per train. Yegge's observation is that this cannot hold at agent
throughput — *any* sequential integration stage eventually backs up behind
parallel producers, and once a batch goes red, bisection-style debugging is
paralysis, because you are serially probing a problem the swarm can attack in
parallel.

So when the merge backlog reaches `thunderdomeAt` (default 12), swarm-kit stops
pretending:

1. **Megabatch** — one agent merges *every* pending branch into main, resolving
   all conflicts, with no interleaved builds.
2. **One validation** for the whole batch.
3. If red: **swarm diagnosis** — `diagnosticians` (default 4) read-only agents
   root-cause disjoint failure subsets in parallel (each claims failures where
   `(index-1) % N == i`), then a single **medic** applies their fixes directly on
   main, up to 3 edit/build/test cycles. This is the one sanctioned exception to
   never-touch-main.
4. Roll forward always. Never bisect. Reverts only for textually irreparable
   merges — a conflict is not a reason to drop work.
5. If the medic can't restore green, the failure escalates into the planner's
   next-wave findings, and the scribe won't tag an un-green wave.

## Credit and economics

The planner/worker swarm architecture is inspired primarily by Cursor's
[agent swarm & model economics](https://cursor.com/blog/agent-swarm-model-economics)
write-up. The Thunderdome pattern (megabatch integration when the merge queue
backs up) is adapted from Steve Yegge's *The Shape of Things to Come*.

In the campaigns this kit was extracted from, it broadly reproduced the shape
of Cursor's swarm results at substantially lower cost — even valuing every
token at raw API list prices — largely because the architecture is
cache-dominated: long-lived planner/worker loops re-read enormous cached
prefixes, so ~97% of token volume bills at cache-read rates, and the strict
model tiering (large model plans, mid-size models implement) keeps output
tokens on the cheapest tier that holds quality.

## Model tiering

Effort is pinned per role in the CONFIG `effort` map. Nothing inherits the runner
session's ambient default — that is deliberate, because a swarm whose reasoning
depth silently follows whatever you last set interactively is not reproducible.

| Tier | Roles | Default |
|---|---|---|
| Orchestrate | root + scoped planners, codebase & final review lenses | Opus @ `xhigh` |
| Integrate | merge trains, Thunderdome, diagnosticians, medic | Opus @ `high` |
| Implement | workers | Sonnet @ `medium` |
| Mechanical | scribe, sentinel, size custodian, light lenses, final tag | Sonnet @ `low` |

**Never run the planner on your largest, most-loaded model.** This one is paid
for: an earlier campaign ran the planner on Fable, and mid-run that model's
context window saturated. Every replan then failed *identically* — the swarm hit
three consecutive planner failures, declared `replan-failures`, and drained. The
fix was demoting the planner one tier, to Opus, which was already proven as the
integration model. The planner is the single point of failure in a swarm: when
it stops producing, everything downstream stops with it. Give it the model with
headroom, not the biggest number.

The integration cluster is the other place not to economize. Cross-branch
conflict resolution and red-main repair are the highest-blast-radius writes in
the system — a merge agent that gives up drops a worker's entire session, and a
medic that guesses breaks main for every wave after it. Workers, by contrast, do
bounded work against concrete instructions with their own tests as a gate, and
Sonnet at `medium` is both sufficient and what makes wide lanes affordable.

Size `lanes` against the platform's concurrency cap (`min(16, cores-2)`) and
leave at least one slot free, so the planner, scribe, and merge train never queue
behind a full wall of workers.

## Feeding results back

The harness builds; it does not grade. When you evaluate a run — walkthroughs, an
eval suite, your own review — write the findings into a file inside the target
repo's `docs/`, one bullet per defect with `file:line` or a rubric ID, commit it,
and point CONFIG's `mandate` at that file. The planner reads `docs/` fresh every
wave, so findings become next-wave tasks. Prune entries as they land, or the
planner keeps re-verifying stale ones.

## Usage-limit saturation

If subscription limits saturate mid-run, the swarm **degrades and drains —
nothing corrupts.** Workers and trains fail to `null` (finished-but-unmerged
branches stay on disk with their commits), and after 3 consecutive planner
failures the run declares `convergedReason: "replan-failures"` and exits with
whatever landed. The heartbeat picks it up and resumes when the window reopens.

One manual optimization the loop skips: finished-but-unmerged branches are
invisible to a resumed planner (it reads main), so their work gets re-planned. If
you happen to be at the keyboard, merging stragglers by hand saves that rework —
but the loop does not need you for correctness.

If your account has overage enabled, saturation won't stop the run, but
prompt-cache TTL drops from 1h to 5min, which raises cost noticeably for a fleet
of short-lived agents.

## Pitfalls (pre-wired, don't undo them)

Each of these cost a run to learn. They are already handled; the note is so you
don't "clean them up."

- **Nested-repo fusion.** If the target repo sits inside another git repo, a bare
  `git` command from the wrong cwd silently commits to the wrong repository.
  Every prompt carries a `git -C <target>` warning, and the sentinel halts the
  run if the target's git-dir stops resolving to itself.
- **Permission stalls.** Unattended runs hit interactive prompts on hook temp
  scripts and `/tmp` reads and hang for hours.
  `--dangerously-skip-permissions` is load-bearing, not laziness.
- **Session-child kills.** An auto-update restart kills non-tmux children
  mid-run. tmux ownership is why the launcher exists.
- **Nested tmux.** Launching from inside tmux inherits `$TMUX` and tmux refuses
  to nest, so the swarm never starts. `env -u TMUX` on the tmux invocation in
  `bin/launch.sh` is the fix — keep it.
- **Silent settings skip.** One invalid value anywhere in `.claude/settings.json`
  makes Claude Code skip the *entire* file in headless mode — hooks and
  permissions both, with no error. Validate interactively once.
- **The agent cap.** The platform caps total agents per session. The workflow
  drains cleanly when it's hit and relaunches from the last `round-N` tag;
  `startWave` exists for exactly this.
- **Disk exhaustion.** Worktree build dirs are the dominant leak on long runs
  (one Rust campaign hit 100GB). Run `bin/janitor.sh`; the sentinel halts below
  `minDiskGb`.
- **Prompt surgery.** After editing role prompts, diff the *rendered* prompts,
  not the source — an interpolation that silently evaluates to `undefined` reads
  fine in the editor.
- **Trust the journal.** `journal.jsonl` in the session dir is the truth about
  what agents did; the tmux pane is a lossy view of it.

## Layout

- `.claude/workflows/swarm-build.js` — the whole harness. Edit `CONFIG` only.
- `.claude/agents/swarm-{planner,worker}.md` — role agents. The planner is
  read-only *by tool restriction*, not by instruction; the worker has no web and
  no spawn. This is what makes "the planner never implements" true rather than
  aspirational.
- `.claude/settings.json` — allows the named workflow.
- `.env.example` — paths and names for the shell scripts.
- `bin/launch.sh` — tmux-owned, permission-skipped, self-monitoring launcher.
- `bin/janitor.sh` — disk janitor for long runs.

## Lineage

Built and hardened across two multi-day campaigns — one that took a SQL engine to
96.6% blind-corpus conformance, one that built a conference-management platform
from a spec — then generalized. The defaults in `CONFIG` are what those runs
converged on, not guesses.

## License

MIT. See `LICENSE`.
