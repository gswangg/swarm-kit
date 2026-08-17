export const meta = {
  name: 'swarm-build',
  description: 'Planner/worker swarm building a target repo toward a spec: plan-ahead waves, worktree workers, merge-train integration with Thunderdome megabatch mode, contention custodian, review lenses, sentinel',
  phases: [{ title: 'Dispatch' }, { title: 'Thunderdome' }, { title: 'Review' }],
}

// ============================================================================
// CONFIG — everything project-specific lives here. Edit this block only.
// Values below are EXAMPLES from a working campaign; replace the paths, goal,
// spec paths, commands and invariants with your own. Concurrency, model and
// effort defaults are tuned — change those only with a reason.
// ============================================================================
const C = {
  // The swarm's repo. Its own git repo (tag round-0 on a green skeleton first).
  target: '/absolute/path/to/target-repo',
  // Scratch dir for worker worktrees (one per task branch). Outside `target`.
  wt: '/absolute/path/to/target-repo-wt',

  // One sentence naming what is being built. Injected into every role prompt.
  goal: 'EXAMPLE: the full local-complete product described in SPEC.md — every job in §1, running with no external accounts or secrets',
  // Where requirements live, with precedence. Read by planner and review lenses.
  specPaths: 'EXAMPLE: SPEC.md (the synthesized authority) and docs/ (vendored sources: docs/clarifications.md overrides all, docs/reference/ behavior docs, docs/fixtures/ seed data — precedence in docs/README.md)',

  // THIS RUN's mandate: priorities, hard policies, scope boundaries. Injected
  // into the planner. Rewrite it per campaign; keep it short and imperative.
  mandate: 'EXAMPLE: docs/findings.md is the mandate — verified-current findings, tiered by priority; work Tier 0 first. TEST POLICY (hard rule): workers run TARGETED tests only (the tests for the area touched) — NEVER the full suite; the FULL suite runs once per merge-train batch and on verification/exit waves only. Deployment and provisioning remain OUT of scope for workers; the operator handles deploys.',

  // Build/test commands, run in a FRESH worktree that may lack dependencies —
  // make buildCmd self-sufficient (guard-install; commit your lockfile).
  buildCmd: '([ -d node_modules ] || npm ci --prefer-offline --no-audit --no-fund --silent) && npm run build',
  testCmd: 'npm test --silent',
  envPreamble: '',   // e.g. 'source .venv/bin/activate' or 'export PATH=...'

  // Non-negotiable rules, injected into every worker.
  invariants: 'EXAMPLE: Fail loudly: exceptions and asserts over silent fallbacks; no backwards-compatibility shims. Every route enforces authz with object-level ownership checks. Type checking stays strict: never weaken the config or delete/skip tests to get green. Code must run with NO secrets present — external services live behind ports with local dev implementations. NO BENCHMARK GAMING: fixtures and rubrics inform what to build, but product code must NEVER reference fixture values or rubric IDs — every feature must work for arbitrary data.',

  // Repo conventions the scribe and planner rely on. Create these in `target`
  // before round-0: a decisions/ dir with a README.md stating the DEC-NNN
  // format, and an empty field guide file.
  decisionsDir: 'decisions/',
  fieldGuidePath: 'field-guide/index.md',
  fieldGuideMaxLines: 60,

  // Optional: decisions become compile-checked constants in the target repo.
  // Set to null to skip.
  decisionsModule: {
    file: 'src/decisions.ts',
    line: (id, title) => `export const ${id.replace(/-/g, '_')} = ${JSON.stringify(title)};`,
  },

  // Where the megafile custodian looks, and what a source file looks like.
  srcDir: 'src',
  sourceFind: "-name '*.ts' -o -name '*.tsx'",

  // Extra focus for the final review pass (spec sections, checklists).
  reviewFocus: 'EXAMPLE: with special attention to §1 of the spec and the security checklist',
  // Domain-specific probe list for the adversarial-execution lens. This one
  // targets a web app; for a CLI or library, describe the equivalent hostile
  // inputs and privilege boundaries instead.
  adversarialProbe: `EXAMPLE: if a runnable dev server exists start it on a free port (kill it before you finish), then probe the RUNNING app with curl as each role: unauthenticated requests to admin routes and admin APIs; a low-privilege session reaching another user's objects or any admin endpoint (IDOR — try object IDs that belong to others); hidden or unapproved content appearing on public pages; submissions accepted after a close date; malformed/oversized bodies to public endpoints.`,

  closedBook: false,

  // Tag & branch conventions. The launcher and janitor assume these.
  tagPrefix: 'round-',        // round-N per green wave; resume reads these
  finalTagName: 'round-final',
  branchPrefix: 'task',       // worker branches: task-w7-a, task-w7-b, ...

  // Concurrency & mechanics.
  // The platform caps concurrent agents at min(16, cores-2). Size `lanes` to
  // leave at least one slot free, so the planner, scribe and merge train never
  // queue behind a full wall of workers (8 cores -> cap 6 -> lanes 4 or 5).
  lanes: 4,             // parallel worker lanes
  waveTasks: 10,        // max tasks a root planner emits per wave
  scopedTasks: 6,       // max tasks a scoped sub-planner emits per round
  lowWater: 8,          // replan when eligible queue drops below this
  mergeTrain: 6,        // max branches per NORMAL merge-train batch
  thunderdomeAt: 12,    // merge backlog >= this triggers Thunderdome megabatch
  diagnosticians: 4,    // parallel diagnosis agents when a megabatch goes red
  reviewEvery: 4,       // review-lens cycle every N waves
  megafileLines: 800,
  contentionConflicts: 4,
  minDiskGb: 5,
  maxDepth: 1,
  maxWaves: Infinity,
  tokenCeiling: Infinity,
  convergeAfter: 3,
  startWave: 0,         // continuation runs: set to last completed wave

  // Models. Opus @ xhigh plans and reviews; Opus @ high integrates; Sonnet
  // implements. DO NOT put the planner on a model whose context window you are
  // also saturating elsewhere — see the model-tiering section of the README.
  plannerModel: 'opus',
  workerModel: 'sonnet',
  // Integration cluster — merge trains, Thunderdome megabatch, diagnosticians,
  // medic. Cross-branch conflict resolution and red-main repair are the
  // highest-blast-radius writes in the system; do not cheap out here.
  integrationModel: 'opus',
  plannerType: 'swarm-planner',  // read-only toolset
  workerType: 'swarm-worker',    // no web, no spawn

  // Reasoning effort per role — pinned explicitly so swarm behavior never
  // depends on the runner session's ambient default. Judgment-heavy roles
  // (planning, conflict-heavy megabatches, root-causing, repair, deep review)
  // run high; bounded implementation runs medium; mechanical roles run low.
  effort: {
    planner: 'xhigh',     // root + scoped planners, codebase/final review
    worker: 'medium',     // concrete bounded feature slices
    merge: 'high',        // normal <=6-branch trains
    dome: 'high',         // Thunderdome megabatch, mass conflict resolution
    diagnose: 'high',     // post-dome root-causing
    medic: 'high',        // fix-forward repair on main
    scribe: 'low',        // mechanical doc/tag application
    lensLight: 'low',     // reports-only + diff-history lenses
    lensAdversarial: 'medium', // runs and probes the live app
    mechanical: 'low',    // sentinel, size custodian, final-tag
  },
}
// ============================================================================

// Continuation runs: the runner loop passes {startWave: N} via Workflow args,
// computed from the target repo's round-N tags — no file edit needed to resume.
if (args && typeof args.startWave === 'number' && args.startWave > 0) C.startWave = args.startWave

const DEC_README = `${C.decisionsDir}README.md`
const NEST_WARN = `IMPORTANT: ${C.target} is a git repository — every git and build command MUST be explicitly targeted (git -C ${C.target} ... or cd ${C.target} && ...). A bare git command from the wrong cwd may operate on the WRONG repo and silently corrupt it.`
const BOOK = C.closedBook
  ? `You work CLOSED BOOK: no internet, no web tools, no external references — ${C.specPaths} and the repo are your only sources.`
  : `You may consult external documentation when useful, but ${C.specPaths} in the repo is the authority on requirements.`

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    decisions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', pattern: '^DEC-\\d{3}$' }, title: { type: 'string' }, rationale: { type: 'string' } },
      required: ['id', 'title', 'rationale'] } },
    tasks: { type: 'array', minItems: 0, maxItems: C.waveTasks + 2, items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' }, branch: { type: 'string' }, kind: { enum: ['implement', 'decompose'] }, integration: { type: 'boolean' },
      dependsOn: { type: 'string' },
      description: { type: 'string' }, dependsOnDecisions: { type: 'array', items: { type: 'string' } } },
      required: ['id', 'branch', 'description'] } },
    fieldGuideAppend: { type: 'string' },
    waveSummary: { type: 'string' },
    goalComplete: { type: 'boolean' },
  },
  required: ['decisions', 'tasks', 'fieldGuideAppend', 'waveSummary'],
}
const SCRIBE_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  fieldGuide: { type: 'string' }, committed: { type: 'boolean' } }, required: ['fieldGuide', 'committed'] }
const WORKER_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  branch: { type: 'string' }, status: { enum: ['done', 'partial', 'blocked'] }, testsPassed: { type: 'boolean' },
  startTs: { type: 'integer' }, endTs: { type: 'integer' },
  notes: { type: 'string' }, fieldGuideSuggestion: { type: 'string' } },
  required: ['branch', 'status', 'testsPassed', 'startTs', 'endTs', 'notes'] }
const TRAIN_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  results: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
    branch: { type: 'string' }, merged: { type: 'boolean' }, conflicts: { type: 'integer' },
    conflictedFiles: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
    required: ['branch', 'merged', 'conflicts'] } },
  buildOk: { type: 'boolean' }, testsSummary: { type: 'string' } },
  required: ['results', 'buildOk', 'testsSummary'] }
const MEDIC_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  buildOk: { type: 'boolean' }, testsSummary: { type: 'string' } },
  required: ['buildOk', 'testsSummary'] }

const PLANNER_ROLE = `You are the planner agent in a planner/worker swarm building ${C.goal}. You make design decisions and decompose work into tasks for worker agents. You never implement — you are read-only by construction. Design decisions are yours alone; never let two tasks decide the same question. Every decision gets a stable ID (DEC-NNN continuing from those in ${C.decisionsDir}), a title, and a rationale. Correctness against the requirements in ${C.specPaths} beats feature count.

TASK SIZING: tasks are sized for roughly 10-15 minutes of focused worker time — a coherent feature slice with its own tests, not a micro-commit. Minimize file overlap between tasks in the same batch; single-owner-per-file within a batch works well. Most tasks must be independently implementable from the CURRENT state of main. When work is GENUINELY sequential — a later task cannot compile or be tested until an earlier one lands — you MAY order tasks with "dependsOn": <id of the prerequisite task>. Use dependsOn sparingly: it serializes lanes and starves throughput when overused.

PREFER WIDTH OVER DEPTH: chains are a last resort, not the default. Chain ONLY where a later task genuinely cannot compile or be tested until the earlier one lands. Do NOT chain merely because two tasks touch the same file — the merge agent RESOLVES conflicts rather than dropping work, so same-file tasks may run in parallel. Do NOT chain independent subsystems. There are ${C.lanes} worker lanes: aim for at least that many tasks eligible to start immediately (no dependsOn, or dependsOn something already landed).

VERIFY BEFORE PLANNING: do not trust prior wave summaries, decision docs, or review findings as facts about the code — read main and confirm what actually exists. Prior waves sometimes record decisions whose implementations never landed, and in-flight merges mean the tree moves under you.

Task kind is normally "implement". Use kind "decompose" SPARINGLY for a genuinely large subsystem: a sub-planner will split it. Flag "integration": true only for a change that must cross many files in one coherent commit — the merge policy will work hardest to land those. Workers are fast but need concrete, bounded instructions — files, exact signatures, decision IDs.

${C.mandate}`

const WORKER_ROLE = `${NEST_WARN}
You are a worker agent in a planner/worker swarm building ${C.goal}. You implement EXACTLY the task delegated to you, on your assigned git branch. Your task is a coherent feature slice (~10-15 minutes of focused work); implement it fully, including its tests, and stay within its stated scope. You never plan, never spawn agents, never make design decisions — if a design gap exists, take the narrowest reasonable interpretation and flag it in your notes. Decisions in ${C.decisionsDir} are binding.${C.decisionsModule ? ` Code depending on decision DEC-NNN must reference its constant in ${C.decisionsModule.file} so the dependency is compile-checked.` : ''} ${BOOK} Use ABSOLUTE paths in every command and never explore outside your worktree and the repo. ${C.invariants} Verify before committing: ${C.buildCmd} and your focused tests green.`

// Sentinel: clock + git-dir integrity + disk headroom in one cheap probe.
let integrityFailure = null
async function sentinel(label) {
  const r = await agent(`Run these three commands in Bash and reply with EXACTLY one line "TS <a> GITDIR <b> DISKGB <c>" using their outputs in order, nothing else:
date +%s
git -C ${C.target} rev-parse --absolute-git-dir 2>&1
df -g / | tail -1 | awk '{print $4}'`,
    { label, model: C.workerModel, effort: C.effort.mechanical, agentType: C.workerType }).catch(() => null)
  const m = String(r || '').match(/TS\s+(\d+)\s+GITDIR\s+(\S+)\s+DISKGB\s+(\d+)/)
  if (!m) { log(`sentinel ${label}: unparseable (${String(r || '').slice(0, 80)})`); return null }
  const ts = Number(m[1])
  if (ts > lastClock) lastClock = ts
  if (m[2] !== `${C.target}/.git`) {
    integrityFailure = `git-dir resolved to ${m[2]} — target/.git is gone or shadowed. HALTING to prevent repo fusion.`
    log(`CRITICAL sentinel: ${integrityFailure}`)
    stop = true; notifyWork()
  } else if (Number(m[3]) < C.minDiskGb) {
    integrityFailure = `disk critically low (${m[3]}GB free). HALTING before ENOSPC corrupts work.`
    log(`CRITICAL sentinel: ${integrityFailure}`)
    stop = true; notifyWork()
  }
  return ts
}

let lastClock = 0
let wave = C.startWave
let stop = false
let replanInFlight = false
let replanFailures = 0
let inFlight = 0
let pendingMerges = 0
let fieldGuide = `Read ${C.fieldGuidePath} in the repo.`
let reviewFindings = []
let lastReviewWave = 0
let scopes = {}
let summary = C.startWave === 0
  ? `This is wave 1. The repo contains only ${C.specPaths}, the decisions framework, the field guide, and a build skeleton. Nothing has been built yet.`
  : `This run CONTINUES a prior session from wave ${C.startWave}. Do not trust prior wave summaries — re-read main and verify what actually exists before planning; prior sessions sometimes recorded decisions whose implementations never landed. Continue toward the goal; set goalComplete only when nothing in ${C.specPaths} remains unimplemented.`

const queue = []
const completed = []
const waveReports = []
const landed = new Set()
const failed = new Set()
const fileConflicts = {}
const custodianed = new Set()
const mergeQueue = []
let trainNo = 0
let mergesDone = 0
let conflictsTotal = 0
let thunderdomes = 0

let waiters = []
const notifyWork = () => { const ws = waiters; waiters = []; ws.forEach((r) => r()) }
const waitForWork = () => new Promise((r) => waiters.push(r))

const t0 = (await sentinel('sentinel-start')) || 0
let converged = false
let convergedReason = null   // 'goal' | 'empty-replans' | 'replan-failures' | set at return otherwise
let emptyReplans = 0
const overBudget = () => (budget.total ? budget.remaining() < 50000 : budget.spent() > C.tokenCeiling)
const overTime = () => converged || wave >= C.maxWaves || overBudget()

const eligible = (t) => !t.dependsOn || landed.has(t.dependsOn)
function takeEligible() {
  const i = queue.findIndex(eligible)
  return i === -1 ? null : queue.splice(i, 1)[0]
}
function dropDependents(id) {
  failed.add(id)
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].dependsOn && failed.has(queue[i].dependsOn)) {
      const t = queue.splice(i, 1)[0]
      log(`dropped ${t.id} (chain broken at ${t.dependsOn})`)
      dropDependents(t.id)
    }
  }
}

function plannerPrompt(scopeNote, prefix) {
  return `${PLANNER_ROLE}

Repository: ${C.target}
Read ${C.specPaths}, ${C.fieldGuidePath}, ${C.decisionsDir} (all files), and review the current source and tests before planning.

Status: ${summary}
${scopeNote}
${reviewFindings.length ? 'Recent review-lens findings (from independent reviewers of the repo/reports/diffs — weigh and address as you judge; VERIFY against the tree, some may be stale):\n' + reviewFindings.slice(-12).map(f => '- ' + f).join('\n') : ''}
There is NO time limit. Keep working until ${C.goal} fully satisfies ${C.specPaths}. Produce up to ${C.waveTasks} tasks sized ~10-15 minutes each (dependsOn only for genuinely sequential work). ONLY when nothing in the requirements remains unimplemented or incorrect: return zero tasks and set goalComplete: true. Never pad with busywork. Branch names must be ${prefix}-a, ${prefix}-b, ... (unique; this prefix is reserved for you). Also provide any new design decisions, a short field-guide append, and a waveSummary of intended state.`
}

async function runPlanWave(scopeNote, prefix, depth) {
  const plan = await agent(plannerPrompt(scopeNote, prefix),
    { label: `planner-${prefix}`, phase: 'Dispatch', model: C.plannerModel, effort: C.effort.planner, agentType: C.plannerType, schema: PLAN_SCHEMA })
  const scr = await agent(`You are the scribe of a planner/worker swarm. ${NEST_WARN}
Repository: ${C.target} (main checkout; you are the only agent committing to main right now, but merges may land concurrently — work quickly and only touch ${C.decisionsDir}, ${C.fieldGuidePath}${C.decisionsModule ? `, and ${C.decisionsModule.file}` : ''}).

Apply mechanically:
${JSON.stringify({ decisions: plan.decisions, fieldGuideAppend: plan.fieldGuideAppend }, null, 2)}

Steps:
1. Write each decision to ${C.decisionsDir}DEC-NNN.md (format per ${DEC_README}).
${C.decisionsModule ? `2. Regenerate ${C.decisionsModule.file} from ALL ${C.decisionsDir} files (one line per decision, of the form: ${C.decisionsModule.line('DEC-001', '<title>')} — keep the header comment).` : '2. (No decisions module configured — skip.)'}
3. Append the field-guide content to ${C.fieldGuidePath}, hard budget ${C.fieldGuideMaxLines} lines (compact older bullets if needed).
4. ${C.envPreamble ? C.envPreamble + ' && ' : ''}cd ${C.target} && ${C.buildCmd} to confirm; then: git -C ${C.target} add -A && git -C ${C.target} commit -m 'scribe wave ${wave + 1}'. THEN run ${C.buildCmd} again in ${C.target} and ONLY if it succeeds: git -C ${C.target} tag -f ${C.tagPrefix}${wave + 1}. If the build is broken, do NOT tag — note it in your report instead.
Return the FULL final ${C.fieldGuidePath} content as fieldGuide, committed: true.`,
    { label: `scribe-w${wave + 1}`, phase: 'Dispatch', model: C.workerModel, effort: C.effort.scribe, agentType: C.workerType, schema: SCRIBE_SCHEMA })
  wave += 1
  fieldGuide = scr.fieldGuide
  summary = `Wave ${wave} planned: ${plan.waveSummary}`
  for (const t of plan.tasks) queue.push({ ...t, depth: depth, scope: prefix })
  if (depth === 0) {
    replanFailures = 0
    if (plan.tasks.length === 0) emptyReplans += 1; else emptyReplans = 0
    if (plan.goalComplete || emptyReplans >= C.convergeAfter) { converged = true; convergedReason = plan.goalComplete ? 'goal' : 'empty-replans'; log(`CONVERGED at wave ${wave} (goalComplete=${!!plan.goalComplete}, emptyReplans=${emptyReplans})`); notifyWork() }
    if (wave - lastReviewWave >= C.reviewEvery) { lastReviewWave = wave; runReviewCycle() }
  }
  log(`wave ${wave}: +${plan.tasks.length} tasks (queue=${queue.length}, ${queue.filter(eligible).length} eligible), ${plan.decisions.length} decisions, spent ${budget.spent()}`)
  notifyWork()
}

async function maybeReplan(force) {
  if (replanInFlight || stop) return
  if (!force && queue.length >= C.lowWater) return
  if (converged || wave >= C.maxWaves) return
  replanInFlight = true
  try {
    await sentinel(`sentinel-w${wave + 1}`)
    if (!stop) await runPlanWave('', `${C.branchPrefix}-w${wave + 1}`, 0)
  } catch (e) {
    log(`replan failed: ${e}`)
    replanFailures += 1
    if (replanFailures >= 3) { converged = true; convergedReason = 'replan-failures'; log('3 consecutive replan failures (agent cap or usage-limit saturation) — draining and finishing') }
  } finally {
    replanInFlight = false
    notifyWork()
  }
}

function queueCustodian(file, count) {
  if (custodianed.has(file)) return
  custodianed.add(file)
  queue.push({ id: `custodian-${file.replace(/[^a-z0-9]/gi, '_')}`, branch: `${C.branchPrefix}-custodian-w${wave}-${custodianed.size}`, kind: 'implement', integration: true, depth: 0, scope: 'custodian',
    description: `CONTENTION DECOMPOSITION (from the structure custodian): ${file} has been involved in ${count} merge conflicts — it is a contention hotspot starving other work. Decompose it into smaller cohesive modules WITHOUT behavior change: extract coherent submodules, keep all public paths working (re-exports), all tests must still pass. Touch only what the decomposition requires.` })
  notifyWork()
  log(`custodian queued contention decomposition of ${file} (${count} conflicts)`)
}

// ---------------------------------------------------------------------------
// Thunderdome (after Yegge, "The Shape of Things to Come"): when the merge
// backlog exceeds thunderdomeAt, sequential trains have lost — batch ALL
// pending branches into main in one pass, run ONE validation, and if it goes
// red, diagnose with a parallel swarm and roll FORWARD. Never bisect.
// ---------------------------------------------------------------------------
function trainPrompt(names, batch) {
  return `You are the merge-train agent of a planner/worker swarm. You integrate a BATCH of finished branches into main in one pass, sharing a single build+test cycle.
${NEST_WARN}
Branches to integrate, in order: ${names.join(', ')}
Worker reports: ${JSON.stringify(batch.map((b) => ({ branch: b.w.branch, status: b.w.status, notes: (b.w.notes || '').slice(0, 150) })))}

Steps:
1. For EACH branch in order: verify it exists with git -C ${C.target} rev-parse --verify <branch> (retry once after 2s before believing it missing — NEVER infer absence from git log). Then git -C ${C.target} merge --no-ff <branch> -m "merge <branch>". CONFLICTS ARE NEVER A REASON TO DROP A MERGE — resolve every conflict by reading both sides and the relevant ${C.decisionsDir} docs. Record conflicted file paths per branch. Between branches a quick build check is wise but NOT a full test run.
2. After ALL branches are merged: ${C.envPreamble ? C.envPreamble + ' && ' : ''}cd ${C.target} && ${C.buildCmd} && ${C.testCmd} — ONE full validation for the whole train. If it fails, repair with genuine effort; if a specific branch's change is irreparable, revert THAT merge (git -C ${C.target} revert -m 1 <merge-commit>) and re-test, reporting merged=false for it — this should be rare.
3. Commit any fixes. For each successfully merged branch: git -C ${C.target} worktree remove --force ${C.wt}/<branch> ; git -C ${C.target} branch -d <branch>.
Return results (one entry per branch: branch, merged, conflicts, conflictedFiles, notes), buildOk, one-line testsSummary.`
}

function domePrompt(names, batch) {
  return `You are the THUNDERDOME megabatch agent of a planner/worker swarm. The merge backlog reached ${batch.length} (threshold ${C.thunderdomeAt}) — sequential integration has lost. Batch EVERYTHING into main in one pass, validate ONCE, roll FORWARD. Never bisect. A parallel diagnosis swarm handles failures after you.
${NEST_WARN}
Branches to integrate, in order: ${names.join(', ')}
Worker reports: ${JSON.stringify(batch.map((b) => ({ branch: b.w.branch, status: b.w.status, notes: (b.w.notes || '').slice(0, 120) })))}

Steps:
1. For EACH branch in order: verify it exists with git -C ${C.target} rev-parse --verify <branch> (retry once after 2s before believing it missing — NEVER infer absence from git log). Then git -C ${C.target} merge --no-ff <branch> -m "merge <branch>". CONFLICTS ARE NEVER A REASON TO DROP A MERGE — resolve every conflict by reading both sides and the relevant ${C.decisionsDir} docs; record conflicted file paths per branch. Do NOT run builds between branches — Thunderdome does ONE validation at the end. Revert a merge ONLY if it is textually irreparable (report merged=false for it).
2. After ALL branches are merged: ${C.envPreamble ? C.envPreamble + ' && ' : ''}cd ${C.target} && ${C.buildCmd} && ${C.testCmd} — ONE validation for the whole megabatch. If it FAILS: do NOT bisect, do NOT revert branches. Make at most one quick pass over obvious mechanical breakage (missing import, duplicate identifier, trivially-conflicting exports), re-run the validation once, then STOP regardless of outcome and report buildOk honestly with the verbatim failing output in testsSummary (as much as fits) — the diagnosis swarm takes it from here.
3. For each successfully merged branch: git -C ${C.target} worktree remove --force ${C.wt}/<branch> ; git -C ${C.target} branch -d <branch>.
Return results (one entry per branch: branch, merged, conflicts, conflictedFiles, notes), buildOk, testsSummary (on failure: the verbatim failing-output tail).`
}

async function swarmDiagnosis(failures) {
  log(`THUNDERDOME: main is red after megabatch — dispatching ${C.diagnosticians} parallel diagnosticians`)
  const reports = (await parallel(Array.from({ length: C.diagnosticians }, (_, i) => () =>
    agent(`You are diagnostician ${i + 1} of ${C.diagnosticians} in a post-Thunderdome swarm diagnosis. main in ${C.target} is red after a megabatch merge. ${NEST_WARN}
Failure report from the merge validation:
${String(failures || '(no summary captured — run the build+test yourself to see the failures)').slice(0, 3000)}

Diagnose READ-ONLY: you may run builds and tests (including single test files) in ${C.target}, but make NO edits and NO commits. To avoid overlapping with the other diagnosticians, number the distinct failures top to bottom starting at 1 and claim those where (index - 1) % ${C.diagnosticians} == ${i}; if that leaves you nothing, claim the failure that looks hardest. For each claimed failure: root-cause it (which merged change broke it, and why — use git -C ${C.target} log/show on the recent merges) and propose a CONCRETE minimal fix: file paths, exact edits or precise instructions. Fixing forward is the policy — never propose reverting a merge unless the work itself is wrong, not just conflicting.
Report one block per failure: FAILURE: / ROOT CAUSE: / FIX:.`,
      { label: `diagnose-t${trainNo}-${i + 1}`, phase: 'Thunderdome', model: C.integrationModel, effort: C.effort.diagnose, agentType: C.workerType })))).filter(Boolean)
  if (!reports.length) {
    log('THUNDERDOME: all diagnosticians failed; escalating red main to the planner')
    reviewFindings.push(`- THUNDERDOME train-${trainNo}: main red after megabatch and diagnosis failed — verify build+test and repair first`)
    return
  }
  const medic = await agent(`You are the medic after a Thunderdome megabatch. main in ${C.target} is red; ${reports.length} diagnosticians have root-caused the failures. ${NEST_WARN}
Their reports:
${reports.map((r, i) => `--- diagnostician ${i + 1} ---\n${String(r).slice(0, 4000)}`).join('\n')}

Apply the fixes DIRECTLY on main in ${C.target} — this is the one sanctioned exception to never-touch-main. Where reports conflict, read the code and use your judgment; fix FORWARD, never revert merged work for being inconvenient. Cycle: edit → ${C.envPreamble ? C.envPreamble + ' && ' : ''}cd ${C.target} && ${C.buildCmd} && ${C.testCmd} → commit progress (git -C ${C.target} add -A && git -C ${C.target} commit -m "thunderdome medic: <what>"). Up to 3 cycles. If still red after 3, commit whatever genuinely improves things and report the remaining failures honestly.
Report buildOk and a one-line testsSummary.`,
    { label: `medic-t${trainNo}`, phase: 'Thunderdome', model: C.integrationModel, effort: C.effort.medic, agentType: C.workerType, schema: MEDIC_SCHEMA })
    .catch(() => null)
  if (medic && medic.buildOk) {
    log(`THUNDERDOME: medic restored green (${medic.testsSummary})`)
  } else {
    log(`THUNDERDOME: main still red after medic (${medic ? medic.testsSummary : 'medic agent failed'}) — escalating to planner`)
    reviewFindings.push(`- THUNDERDOME train-${trainNo}: main red after megabatch; medic could not fully repair: ${(medic ? medic.testsSummary : 'medic agent failed').slice(0, 200)}`)
  }
}

async function mergeDispatcher() {
  while (true) {
    if (mergeQueue.length === 0) {
      if (stop && inFlight === 0) return
      await waitForWork()
      continue
    }
    const dome = mergeQueue.length >= C.thunderdomeAt
    const batch = mergeQueue.splice(0, dome ? mergeQueue.length : C.mergeTrain)
    trainNo += 1
    if (dome) { thunderdomes += 1; log(`THUNDERDOME train-${trainNo}: megabatching ${batch.length} pending branches`) }
    const names = batch.map((b) => b.w.branch)
    const t = await agent(dome ? domePrompt(names, batch) : trainPrompt(names, batch),
      { label: dome ? `THUNDERDOME-${trainNo}(${batch.length})` : `train-${trainNo}(${batch.length})`, phase: dome ? 'Thunderdome' : 'Dispatch', model: C.integrationModel, effort: dome ? C.effort.dome : C.effort.merge, agentType: C.workerType, schema: TRAIN_SCHEMA })
      .catch(() => null)
    const byBranch = {}
    for (const r of (t && t.results) || []) byBranch[r.branch] = r
    for (const b of batch) {
      const r = byBranch[b.w.branch]
      mergesDone += 1
      if (r && r.merged) {
        conflictsTotal += r.conflicts || 0
        for (const f0 of (r.conflictedFiles || [])) {
          const f = f0.replace(new RegExp(`^${C.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '')
          fileConflicts[f] = (fileConflicts[f] || 0) + 1
          if (fileConflicts[f] >= C.contentionConflicts) queueCustodian(f, fileConflicts[f])
        }
        landed.add(b.task.id)
        waveReports.push({ wave, branch: b.w.branch, status: b.w.status, span: (b.w.endTs - b.w.startTs) || 0, conflicts: r.conflicts, merged: true, buildOk: t.buildOk })
      } else {
        dropDependents(b.task.id)
        log(`train-${trainNo}: ${b.w.branch} not merged (${r ? (r.notes || 'no notes') : 'train agent failed'})`.slice(0, 140))
      }
      pendingMerges -= 1
    }
    log(`${dome ? 'THUNDERDOME' : 'train'}-${trainNo}: ${batch.length} branches, ${((t && t.results) || []).filter((r) => r.merged).length} landed, buildOk=${t ? t.buildOk : 'n/a'} (queue ${mergeQueue.length})`)
    if (dome && t && !t.buildOk) await swarmDiagnosis(t.testsSummary)
    notifyWork()
  }
}

const SCOPED_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  tasks: PLAN_SCHEMA.properties.tasks, decisions: PLAN_SCHEMA.properties.decisions,
  scopeDone: { type: 'boolean' }, scopeSummary: { type: 'string' } },
  required: ['tasks', 'decisions', 'scopeDone', 'scopeSummary'] }

async function runScopedPlanner(task) {
  const sid = task.branch
  scopes[sid] = { pending: 0, summary: 'New scope. ' + task.description, done: false, round: 0 }
  while (!scopes[sid].done && !stop && !overTime()) {
    const s = scopes[sid]
    s.round += 1
    const plan = await agent(`${PLANNER_ROLE}

You are a SCOPED PLANNER: the root planner delegated this subtree to you. Repository: ${C.target}.
Your scope (boundary is binding — decide only questions INSIDE it; existing decisions are binding):
${task.description}

Your scope state: ${s.summary}
Read the current code before planning. Produce up to ${C.scopedTasks} implement tasks sized ~10-15 min each (no decompose; dependsOn only where genuinely sequential), branch names ${sid}-r${s.round}-a onward. New decisions use IDs continuing from ${C.decisionsDir}. Set scopeDone: true when the subtree is complete.`,
      { label: `scoped-${sid}-r${s.round}`, phase: 'Dispatch', model: C.plannerModel, effort: C.effort.planner, agentType: C.plannerType, schema: SCOPED_SCHEMA })
    if (plan.decisions.length) {
      await agent(`You are the scribe. ${NEST_WARN}
Repository: ${C.target}. Write these decisions to ${C.decisionsDir} (format per ${DEC_README})${C.decisionsModule ? ` and regenerate ${C.decisionsModule.file} from ALL decision files` : ''}; ${C.envPreamble ? C.envPreamble + ' && ' : ''}cd ${C.target} && ${C.buildCmd}; then git -C ${C.target} add -A && git -C ${C.target} commit -m 'scribe scope ${sid}'.
${JSON.stringify(plan.decisions, null, 2)}
Return committed: true and fieldGuide as the current ${C.fieldGuidePath} content.`,
        { label: `scribe-${sid}-r${s.round}`, phase: 'Dispatch', model: C.workerModel, effort: C.effort.scribe, agentType: C.workerType, schema: SCRIBE_SCHEMA })
    }
    s.summary = plan.scopeSummary
    s.done = plan.scopeDone
    if (plan.tasks.length === 0) break
    s.pending += plan.tasks.length
    for (const t of plan.tasks) queue.push({ ...t, depth: task.depth + 1, scope: sid })
    notifyWork()
    while (s.pending > 0 && !stop) await waitForScope(sid)
  }
  log(`scope ${sid} finished (${scopes[sid].round} rounds)`)
}
let scopeWaiters = {}
const waitForScope = (sid) => new Promise((r) => { (scopeWaiters[sid] = scopeWaiters[sid] || []).push(r) })
const notifyScope = (sid) => { const ws = scopeWaiters[sid] || []; scopeWaiters[sid] = []; ws.forEach((r) => r()) }

function runReviewCycle() {
  const lenses = [
    ['lens-codebase', C.plannerModel, C.plannerType, C.effort.planner, `Fresh-eyes CODEBASE review: read ${C.specPaths} and review the source in ${C.target} against those requirements (spot-check what the code claims to implement, including failure modes the tests would not exercise — authz gaps, unhandled input classes, silent contract violations). Report the top 4 concrete defects, one line each, with file:line.`],
    ['lens-reports', C.workerModel, C.workerType, C.effort.lensLight, `OUTPUT-ONLY review: read ONLY the last 15 git commit messages of ${C.target} (git -C ${C.target} log --format='%s' -15) and ${C.fieldGuidePath} and the ${C.decisionsDir} index. From what the swarm SAYS it did, list up to 4 suspicious gaps or contradictions, one line each. Do not read source code.`],
    ['lens-diffs', C.workerModel, C.workerType, C.effort.lensLight, `CHANGE-HISTORY review: read the last 3 waves of changes in ${C.target} (git -C ${C.target} log -p -20 --stat, skim). List up to 4 risky or sloppy changes (silent behavior changes, dead code, tests weakened), one line each with the commit.`],
    // ADVERSARIAL EXECUTION lens: the only lens that runs the product. It
    // catches the failures tests are structurally blind to — privilege and
    // visibility leaks that every unit test passes around.
    ['lens-adversarial', C.workerModel, C.workerType, C.effort.lensAdversarial, `ADVERSARIAL EXECUTION review of the software in ${C.target}: ${C.envPreamble ? C.envPreamble + '; ' : ''}build it (${C.buildCmd}), then run it and attack it. ${C.adversarialProbe} Check the invariants stated in ${C.specPaths}. Report up to 4 concrete failing interactions (input, expected vs observed), one line each. If the software cannot yet run end-to-end, report exactly that as your single finding.`],
  ]
  for (const [label, model, agentType, effort, prompt] of lenses) {
    agent(prompt, { label, phase: 'Dispatch', model, effort, agentType })
      .then((r) => { if (r) reviewFindings.push(...String(r).split('\n').filter((l) => l.trim().startsWith('-') || /:\d+/.test(l)).slice(0, 4)) })
      .catch(() => {})
  }
  agent(`Megafile custodian: run: find ${C.target}/${C.srcDir} ${C.sourceFind} 2>/dev/null | head -200 | xargs wc -l 2>/dev/null | sort -n | tail -2 | head -1. Report ONLY that file and its line count as "FILE <path> <lines>".`,
    { label: 'custodian-size', phase: 'Dispatch', model: C.workerModel, agentType: C.workerType, effort: C.effort.mechanical })
    .then((r) => {
      const m = String(r || '').match(/FILE\s+(\S+)\s+(\d+)/)
      if (m && Number(m[2]) > C.megafileLines) queueCustodian(m[1], `${m[2]} lines`)
    })
    .catch(() => {})
}

async function lane(id) {
  while (true) {
    if (stop) return
    const task = takeEligible()
    if (!task) {
      if (overTime()) { stop = true; notifyWork(); return }
      maybeReplan(false)
      if (!replanInFlight && inFlight === 0 && pendingMerges === 0) {
        if (queue.length > 0) {
          // Only ineligible tasks remain and nothing in flight can unblock them.
          for (const t of queue.splice(0)) log(`dropped stuck ${t.id} (dependsOn ${t.dependsOn} never landed)`)
          continue
        }
        stop = true; notifyWork(); return
      }
      await waitForWork()
      continue
    }
    if (task.kind === 'decompose' && task.depth < C.maxDepth) {
      runScopedPlanner(task).catch((e) => log(`scoped planner ${task.id} failed: ${e}`))
      continue
    }
    inFlight += 1
    const w = await agent(`${WORKER_ROLE}

Field guide (injected):
${fieldGuide}

Your task (id ${task.id}), constrained by decisions ${(task.dependsOnDecisions || []).join(', ') || '(none listed)'}:${task.dependsOn ? `\n(This is a chain link: its prerequisite task ${task.dependsOn} has ALREADY merged into main — branch fresh from main and build directly on it.)` : ''}
${task.description}

Workflow:
1. Run \`date +%s\` (report later as startTs).
2. ${C.envPreamble ? C.envPreamble + ' (keep it set for every build command). Then: ' : ''}git -C ${C.target} worktree add ${C.wt}/${task.branch} -b ${task.branch} main
   (on a lock error: sleep 2, retry once)
3. Work ONLY inside ${C.wt}/${task.branch}, absolute paths everywhere. Never touch ${C.target} directly, never merge.
4. Implement the task; ${C.buildCmd} and ${C.testCmd} until green (your branch must build standalone).${task.integration ? ' This is a LICENSED INTEGRATION task: cross-file scope is expected; if making every existing test pass is beyond one session, land building code with the failing tests documented in your notes.' : ''}
5. Commit inside your worktree: git -C ${C.wt}/${task.branch} add -A && git -C ${C.wt}/${task.branch} commit -m "<message>". NEVER run git without -C, and never against ${C.target} or any parent directory. Run \`date +%s\` (endTs).
Report branch, status, testsPassed, startTs, endTs, concise notes.`,
      { label: `worker-${task.branch}`, phase: 'Dispatch', model: C.workerModel, effort: C.effort.worker, agentType: C.workerType, schema: WORKER_SCHEMA })
      .catch(() => null)
    if (w && w.branch) {
      completed.push(w)
      if (w.endTs && w.endTs > lastClock) lastClock = w.endTs
      pendingMerges += 1
      mergeQueue.push({ task, w })
      if (overTime()) { stop = true }
    } else {
      dropDependents(task.id)
    }
    inFlight -= 1
    if (task.scope && scopes[task.scope]) { scopes[task.scope].pending -= 1; notifyScope(task.scope) }
    notifyWork()
    maybeReplan(false)
  }
}

phase('Dispatch')
await maybeReplan(true)
await parallel([...Array.from({ length: C.lanes }, (_, i) => () => lane(i + 1)), () => mergeDispatcher()])
stop = true
notifyWork()

const finalTag = await agent(`Repository: ${C.target}. Run: ${C.envPreamble ? C.envPreamble + ' && ' : ''}cd ${C.target} && ${C.buildCmd} && ${C.testCmd} 2>&1 | tail -3 && git -C ${C.target} tag -f ${C.finalTagName} && git -C ${C.target} log --oneline | head -3. Report the verbatim output.`,
  { label: 'final-tag', phase: 'Dispatch', model: C.workerModel, effort: C.effort.mechanical, agentType: C.workerType }).catch((e) => `final-tag failed (likely agent cap): ${e}`)

phase('Review')
const review = await agent(`You are a review agent looking at a codebase with fresh eyes — you have NOT seen how it was built (codebase-only lens). Repository: ${C.target}. Read ${C.specPaths}, then review the source against those requirements (spot-check what the code claims to implement, ${C.reviewFocus}). Report the top 5 concrete issues with file:line, plus any decision doc that narrows the requirements instead of implementing them. Do not fix anything.`,
  { label: 'review-final', model: C.plannerModel, effort: C.effort.planner, agentType: C.plannerType }).catch((e) => `review failed (likely agent cap): ${e}`)

const tEnd = (await sentinel('sentinel-end')) || lastClock
if (!convergedReason) convergedReason = overBudget() ? 'budget' : (wave >= C.maxWaves ? 'max-waves' : (integrityFailure ? 'integrity-halt' : 'drained'))
return {
  convergedReason: convergedReason,
  elapsedSeconds: tEnd - t0,
  waves: wave - C.startWave,
  tasksCompleted: completed.length,
  merges: mergesDone,
  mergesLanded: landed.size,
  thunderdomes: thunderdomes,
  conflictsTotal: conflictsTotal,
  fileConflicts: fileConflicts,
  integrityFailure: integrityFailure,
  workerSpans: completed.map((w) => ({ branch: w.branch, status: w.status, span: (w.endTs - w.startTs) || 0 })),
  finalTag: (finalTag || '').slice(0, 400),
  review: (review || '').slice(0, 3000),
  totalTokens: budget.spent(),
}
