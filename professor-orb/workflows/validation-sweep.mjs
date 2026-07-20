// validation-sweep: KB-wide convention audit for a professor-orb campaign project.
//
// TWO-PHASE COVENANT (read this before invoking):
//
// This workflow runs in the background and cannot ask the DM anything mid-run,
// so mutation is split into two separate invocations, driven by args.mode:
//
//   1. SCAN phase (default, or args.mode === "scan"): read-only. Shards the KB
//      across parallel haiku checkers, aggregates a KB-wide singleOwnership
//      pass, and returns one merged report: violations sorted into
//      mechanicallyFixable (exact fix stated) and needsJudgment (exact DM
//      question stated), plus a proposed replacement tag registry. Mutates
//      NOTHING. If .professor-orb/conventions.json is missing, this phase
//      returns a short "setup has not been run" report and does nothing else.
//
//   2. FIX phase (args.mode === "fix"): the DM's main session, after showing
//      the scan report and getting the DM's batch approval for the whole
//      mechanicallyFixable bucket (one yes covers the bucket) via
//      AskUserQuestion, resolves needs-judgment items individually, then
//      re-invokes this workflow with:
//        args = {
//          mode: "fix",
//          approvedFixes: [ { file, ruleId, description, fix }, ... ],
//          approvedTagRegistry: { tagName: count, ... }   // optional
//          tagRegistryPath: ".professor-orb/tag-registry.json" // optional
//        }
//      The fix phase applies ONLY what args carries. It never invents a fix,
//      never re-derives the fixable bucket itself, and never batch-fixes a
//      needs-judgment item (those are resolved one at a time in the main
//      session before this phase is invoked). Each approved fix is applied by
//      a dedicated haiku subagent using Write or Edit, so those writes pass
//      through the consumer project's PostToolUse validator hook like any
//      other edit.
//
// Neither phase reads the clock or generates randomness: this script never
// calls Date.now, new Date with no arguments, or Math.random. Any date a fix
// needs (for example an "updated" frontmatter stamp) must already be baked
// into the fix value the main session passes in args.approvedFixes.

export const meta = {
  name: 'validation-sweep',
  description:
    'KB-wide convention audit for a professor-orb campaign project. Scan phase (default) shards the knowledge base across parallel haiku checkers, aggregates a KB-wide single-ownership pass, and returns a merged report split into mechanically fixable and needs-judgment violations plus a proposed tag registry, mutating nothing. Fix phase (args.mode "fix") applies only the DM-approved fixes passed in args, via dedicated haiku fixer subagents. Invoke by name validation-sweep; pass args.mode and, for the fix phase, args.approvedFixes.',
  whenToUse:
    'Run the scan phase on demand for a KB health audit, or as a heavier alternative to a single kb-validator spot-check when the DM wants full KB coverage. Run the fix phase only after the DM has reviewed a scan report and approved the mechanically fixable bucket (and, if offered, the regenerated tag registry).',
  phases: [
    { title: 'Scout', detail: 'Read conventions.json and enumerate every KB article file' },
    { title: 'Check', detail: 'Shard the file list and validate each shard in parallel' },
    { title: 'Aggregate', detail: 'Cross-shard single-ownership pass, bucket merge, tag registry proposal' },
    { title: 'Fix', detail: 'Apply DM-approved fixes and, if approved, write the new tag registry' },
  ],
}

// args may arrive already parsed (an object) or, on some hosts, as the raw
// JSON string the caller passed. Accept both so the same invocation works
// either way.
const input = (typeof args === 'string' && args.trim() ? JSON.parse(args) : args) || {}
const mode = input.mode === 'fix' ? 'fix' : 'scan'
const shardSize = 12

const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    conventionsFound: { type: 'boolean' },
    kbRoot: { type: 'string' },
    tagRegistryPath: { type: 'string' },
    rulesJson: { type: 'string' },
    indexSuffix: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    message: { type: 'string' },
  },
  required: ['conventionsFound'],
}

const CHECKER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    shardId: { type: 'string' },
    filesChecked: { type: 'number' },
    articles: { type: 'array', items: { type: 'string' } },
    catalogEntries: { type: 'array', items: { type: 'string' } },
    ownershipClaims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          indexFile: { type: 'string' },
          ownedArticle: { type: 'string' },
        },
        required: ['indexFile', 'ownedArticle'],
      },
    },
    tagsUsed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tag: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['tag', 'count'],
      },
    },
    mechanicallyFixable: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          ruleId: { type: 'string' },
          description: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['file', 'description', 'fix'],
      },
    },
    needsJudgment: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          ruleId: { type: 'string' },
          description: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['file', 'description', 'question'],
      },
    },
  },
  required: ['shardId', 'filesChecked', 'articles', 'ownershipClaims', 'tagsUsed', 'mechanicallyFixable', 'needsJudgment'],
}

const FIX_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string' },
    applied: { type: 'boolean' },
    detail: { type: 'string' },
  },
  required: ['file', 'applied'],
}

const TAG_REGISTRY_WRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    written: { type: 'boolean' },
    path: { type: 'string' },
    detail: { type: 'string' },
  },
  required: ['written'],
}

const scoutPrompt = [
  'You are the scout stage of a knowledge base validation sweep for a D&D campaign project.',
  '',
  'Step 1: Look for .professor-orb/conventions.json at the project root (relative to your current working directory) and read it. If the file is missing, unreadable, or is not valid JSON, return conventionsFound false and a short message field explaining that professor-orb setup has not been run for this project yet. Do nothing else in that case: do not enumerate files, do not guess at conventions.',
  '',
  'Step 2: If conventions.json is present and valid, read its top-level kbRoot, tagRegistryPath (if absent, use ".professor-orb/tag-registry.json"), and rules fields. Look through the rules object for any rule whose check is "indexParity" and note its params.indexSuffix (for example "-INDEX"). If no such rule exists, use an empty string for indexSuffix.',
  '',
  'Step 3: Enumerate every markdown article file under kbRoot, recursively, using paths relative to the project root (the same root conventions.json itself is relative to), for example "rolara-kb/npcs/thoric-brightaxe.md". Do not include conventions.json, the tag registry file, or non-markdown files.',
  '',
  'Return: conventionsFound (true), kbRoot, tagRegistryPath, rulesJson (the exact rules object from conventions.json, re-serialized as a JSON string, verbatim: every rule it defines, nothing summarized or dropped), indexSuffix, files (the full array of relative markdown file paths under kbRoot), message (empty string when conventions were found).',
].join('\n')

const checkerPrompt = (shardFiles, shardIdx, kbRoot, rulesJson, indexSuffix) =>
  [
    'You are checker shard ' + shardIdx + ' of a knowledge base validation sweep for a D&D campaign project. Check ONLY the files listed below against the project conventions given below. Do not check, open, or report on any other file.',
    '',
    'Files in this shard (paths relative to the project root):',
    JSON.stringify(shardFiles),
    '',
    'The KB root is: ' + kbRoot,
    'Hint for spotting index files by filename suffix, if this project uses one: "' + indexSuffix + '" (empty means the project has no dedicated suffix; in that case judge by content instead: an index file is mostly a grouped list of wikilinks under headings, not a normal article).',
    '',
    'The project conventions, the rules object from conventions.json, verbatim JSON (rule IDs are free-form: check exactly what is defined here, do not assume a different project\'s rule names):',
    rulesJson,
    '',
    'For each file in your shard:',
    '1. Read the file: frontmatter and body.',
    '2. Decide whether it functions as an index file for its folder (by the suffix hint above, or by content). Index files are not "articles" being validated for ownership; they are the source of ownership claims for the articles they list.',
    '3. Decide whether it is a catalog entry: frontmatter type is exactly "Homebrew". Catalog entries ARE subject to index ownership checks (a real index should still list them), but are EXEMPT from wikilink and orphan checks: never flag a catalog entry for having no outgoing wikilinks or for not being linked to from other article bodies. That is correct structure for a catalog entry, not a violation.',
    '4. Check every frontmatter category rule against this file: requiredFields (the listed fields are present, and in the given order if orderMatters is true), enum (the named field holds one of the allowed values), default (a field missing its documented default, given this file\'s other field values and any override), format (a present field matches its declared type: string, boolean, string-array, or date), frontmatterImpliesFrontmatter (if this file\'s own frontmatter matches params.when, then every field named in params.requireFrontmatter must be present in the frontmatter carrying exactly that value; a missing field is a violation, not a pass, because the point of the rule is that an absent field falls back to a default. This is the leak guard, for example a dm-only or NSFW tag must force publish: false explicitly; it is the frontmatter-triggered sibling of bodyImpliesFrontmatter in step 6, same requireFrontmatter mechanism, triggered by a frontmatter condition instead of a body pattern). Report a frontmatterImpliesFrontmatter violation as mechanically fixable: the fix is to set the named fields to the required values.',
    '5. Check every filename category rule: suffixByType (the file\'s type carries its mandatory suffix per the mapping), charset (the filename, minus extension, matches the allowed character pattern).',
    '6. Check every content category rule, skipping wikilink and orphan checks for catalog entries per step 3: wikilinkPolicy (wikilinks are well formed; inside Markdown tables the pipe separator is escaped as \\| ([[Target\\|Display]]), which is required table syntax equivalent to the bare-pipe form, never a malformed link and never something to "fix"; if requireExistingTarget is true and a target clearly does not exist anywhere plausible, flag it, but if you cannot confirm one way or the other because the target might live in a different shard, do not flag it; if requireDisplayText is true, a wikilink with no separator at all, for example [[Target]], is a violation for missing display text, while a wikilink that has one, whether table-escaped or plain, still passes), tagVocabulary (never block on this; only collect tag usage, and only add an informational finding if the rule\'s enforcement is not "off"), prohibitedPattern (the body or frontmatter, per appliesTo, does not contain the disallowed pattern, for example an em dash character; when a rule also bans a double-hyphen used as a prose em-dash substitute, Markdown table delimiter rows and horizontal rules are NOT violations, only a double-hyphen between words in prose is), bodyImpliesFrontmatter (if the body matches params.bodyPattern, treated as a regular expression with params.flags, then every field named in params.requireFrontmatter must be present in the frontmatter carrying exactly that value; a missing field is a violation, not a pass, because the point of the rule is that an absent field falls back to a default; see frontmatterImpliesFrontmatter in step 4 for the same mechanism triggered by a frontmatter condition instead of a body pattern). Report a bodyImpliesFrontmatter violation as mechanically fixable: the fix is to set the named fields to the required values.',
    '7. Do NOT evaluate indexParity or singleOwnership yourself: indexParity needs the whole folder\'s file list and singleOwnership needs the whole KB, and both are handled centrally after every shard reports back. Instead, if this file is an index file, extract every wikilink target it lists as an ownership claim: this index claims to own that article.',
    '8. Collect every tag this shard\'s articles use in frontmatter, with a count of how many files in this shard use each tag.',
    '',
    'Classify every violation you find into exactly one bucket:',
    '- Mechanically fixable: exactly one unambiguous correction exists. State the exact fix (the corrected value, filename, or link).',
    '- Needs judgment: more than one reasonable resolution exists, or the fix depends on DM intent you cannot infer. State the exact question to ask the DM.',
    'If you are not sure which bucket a violation belongs in, use needs judgment: a DM asked an unnecessary question loses less than a DM whose article gets a wrong guessed fix.',
    '',
    'Return structured data only: shardId ("shard-' + shardIdx + '"), filesChecked (count of files you actually read), articles (relative paths of files in this shard that are NOT index files, including catalog entries), catalogEntries (relative paths of catalog entries in this shard), ownershipClaims (array of objects with indexFile and ownedArticle, one per wikilink an index file in this shard lists), tagsUsed (array of objects with tag and count, for this shard only), mechanicallyFixable (array of objects with file, ruleId, description, fix), needsJudgment (array of objects with file, ruleId, description, question).',
  ].join('\n')

const fixPrompt = (item) =>
  [
    'You are applying ONE DM-approved fix to a knowledge base article for a D&D campaign project. Apply EXACTLY the fix described below. Nothing more, nothing invented, nothing else on the file.',
    '',
    'File: ' + item.file,
    'Rule: ' + (item.ruleId || '(not provided)'),
    'Violation: ' + (item.description || '(not provided)'),
    'Approved fix: ' + item.fix,
    '',
    'Read the file, apply the approved fix precisely using the Write or Edit tool, and save it. Do not make any other change to the file, and do not fix any other violation you happen to notice in it; report it in detail instead, do not touch it.',
    'If the approved fix cannot be applied exactly as described (for example the file no longer matches the violation described, or the fix conflicts with the file\'s current content), do not guess: leave the file unchanged, return applied false, and explain why in detail.',
    '',
    'Return: file (the path you were given), applied (true only if you made exactly the described change and saved it), detail (a short note on what you changed, or on why you could not).',
  ].join('\n')

const tagRegistryPrompt = (path, registry) =>
  [
    'You are writing the DM-approved tag registry for a D&D campaign knowledge base. Write EXACTLY the JSON object given below to ' + path + ' (relative to the project root), pretty-printed with two-space indentation. Do not add, remove, rename, or recount any tag; this content was already approved by the DM and must be written verbatim.',
    '',
    'Approved tag registry (JSON):',
    JSON.stringify(registry, null, 2),
    '',
    'Return: written (true only if the file was saved with exactly this content), path (the path you wrote), detail (a short confirmation, or an explanation of any problem).',
  ].join('\n')

// Everything above is pure setup (schemas, prompt builders, parsed args). All
// control flow lives inside this function so every early exit is a normal
// function return: a bare top-level "return" is not legal syntax in a real
// ES module (this file is .mjs, not the CommonJS-wrapped .js some hosts also
// accept), so the two-phase logic below is wrapped in run() and its result
// is handed off via a plain export at the bottom of the file.
async function run() {
  if (mode === 'fix') {
    phase('Fix')

    const approvedFixes = Array.isArray(input.approvedFixes) ? input.approvedFixes : []
    const approvedTagRegistry =
      input.approvedTagRegistry && typeof input.approvedTagRegistry === 'object' ? input.approvedTagRegistry : null
    const tagRegistryPath = input.tagRegistryPath || '.professor-orb/tag-registry.json'

    if (approvedFixes.length === 0 && !approvedTagRegistry) {
      log(
        'Fix phase invoked with no approved fixes and no approved tag registry in args. The fix phase applies only what args carries, so there is nothing to do.',
      )
      return {
        mode: 'fix',
        applied: [],
        failed: [],
        fixesDropped: 0,
        tagRegistryWritten: false,
        message:
          'No approved fixes or approved tag registry were supplied in args. Nothing was written. Re-invoke with args.approvedFixes (and, if approved, args.approvedTagRegistry) after the DM reviews a scan report.',
      }
    }

    log(
      'Applying ' +
        approvedFixes.length +
        ' DM-approved fix(es)' +
        (approvedTagRegistry ? ' and writing the approved tag registry' : '') +
        '. Needs-judgment items are never batch-fixed here; only what args carries is applied.',
    )

    const fixResultsRaw =
      approvedFixes.length > 0
        ? await parallel(
            approvedFixes.map((item) => () =>
              agent(fixPrompt(item), { model: 'haiku', label: 'fix:' + item.file, phase: 'Fix', schema: FIX_RESULT_SCHEMA }),
            ),
          )
        : []
    const fixResults = fixResultsRaw.filter(Boolean)
    const droppedFixCount = fixResultsRaw.length - fixResults.length
    if (droppedFixCount > 0) {
      log(
        'Warning: ' +
          droppedFixCount +
          ' of ' +
          fixResultsRaw.length +
          ' fixer subagent(s) failed or returned nothing. Those files were not confirmed applied and need a manual look; they are not silently counted as done.',
      )
    }

    const applied = fixResults.filter((r) => r.applied)
    const failed = fixResults.filter((r) => !r.applied)

    let tagRegistryWritten = false
    let tagRegistryDetail = null
    if (approvedTagRegistry) {
      const tagRegistryResult = await agent(tagRegistryPrompt(tagRegistryPath, approvedTagRegistry), {
        model: 'haiku',
        label: 'write:tag-registry',
        phase: 'Fix',
        schema: TAG_REGISTRY_WRITE_SCHEMA,
      })
      if (!tagRegistryResult) {
        log('Warning: the tag registry write subagent failed or returned nothing. The tag registry was not confirmed written.')
      }
      tagRegistryWritten = Boolean(tagRegistryResult && tagRegistryResult.written)
      tagRegistryDetail = tagRegistryResult
    }

    log(
      'Fix phase complete: ' +
        applied.length +
        ' of ' +
        approvedFixes.length +
        ' approved fix(es) applied' +
        (droppedFixCount > 0 ? ' (' + droppedFixCount + ' dropped)' : '') +
        '.' +
        (approvedTagRegistry ? ' Tag registry write ' + (tagRegistryWritten ? 'succeeded' : 'did not confirm') + '.' : ''),
    )

    return {
      mode: 'fix',
      applied,
      failed,
      fixesDropped: droppedFixCount,
      tagRegistryWritten,
      tagRegistryDetail,
    }
  }

  // Scan phase (default).
  phase('Scout')

  const scout = await agent(scoutPrompt, { model: 'haiku', label: 'scout', phase: 'Scout', schema: SCOUT_SCHEMA })

  if (!scout || !scout.conventionsFound) {
    log('conventions.json is missing or unreadable. Returning a setup-not-run report without scanning anything.')
    return {
      mode: 'scan',
      conventionsFound: false,
      message:
        (scout && scout.message) ||
        'Setup has not been run for this project: .professor-orb/conventions.json is missing or unreadable. Run the professor-orb setup skill before using the validation sweep.',
      mechanicallyFixable: [],
      needsJudgment: [],
      singleOwnershipFindings: [],
      indexParityFindings: [],
      proposedTagRegistry: {},
    }
  }

  const kbRoot = scout.kbRoot || ''
  const files = Array.isArray(scout.files) ? scout.files : []
  const rulesJson = scout.rulesJson || '{}'
  const indexSuffix = scout.indexSuffix || ''
  const tagRegistryPath = scout.tagRegistryPath || '.professor-orb/tag-registry.json'

  let rules = {}
  try {
    rules = JSON.parse(rulesJson)
  } catch (err) {
    log('Warning: the rules JSON returned by the scout could not be parsed; proceeding with an empty rule set for this run. ' + err.message)
    rules = {}
  }

  let singleOwnershipRuleId = 'singleOwnership'
  for (const ruleId of Object.keys(rules)) {
    if (rules[ruleId] && rules[ruleId].check === 'singleOwnership') {
      singleOwnershipRuleId = ruleId
      break
    }
  }

  // indexParity is a whole-folder rule, so like singleOwnership no single shard
  // can judge it: a shard sees only its slice of a folder, never the folder's
  // full file list. It is evaluated centrally in the Aggregate phase below from
  // the scout's complete enumeration. Discover its rule id the same way, so the
  // finding carries the project's own rule name (for example structuralIndexParity).
  let indexParityRuleId = 'indexParity'
  for (const ruleId of Object.keys(rules)) {
    if (rules[ruleId] && rules[ruleId].check === 'indexParity') {
      indexParityRuleId = ruleId
      break
    }
  }

  if (files.length === 0) {
    log('Scout found conventions.json but no markdown article files under kbRoot. Nothing to check.')
    return {
      mode: 'scan',
      conventionsFound: true,
      kbRoot,
      filesScanned: 0,
      shardsChecked: 0,
      shardsDropped: 0,
      mechanicallyFixable: [],
      needsJudgment: [],
      singleOwnershipFindings: [],
      indexParityFindings: [],
      proposedTagRegistry: {},
      tagRegistryPath,
      nextStep: 'No KB articles were found under kbRoot. Confirm kbRoot in .professor-orb/conventions.json points at the right folder.',
    }
  }

  phase('Check')

  const shards = []
  for (let i = 0; i < files.length; i += shardSize) {
    shards.push(files.slice(i, i + shardSize))
  }
  log('Partitioned ' + files.length + ' KB file(s) into ' + shards.length + ' shard(s) of up to ' + shardSize + ' file(s) each.')

  const checkerResultsRaw = await parallel(
    shards.map((shardFiles, shardIdx) => () =>
      agent(checkerPrompt(shardFiles, shardIdx, kbRoot, rulesJson, indexSuffix), {
        model: 'haiku',
        label: 'check:shard-' + shardIdx,
        phase: 'Check',
        schema: CHECKER_SCHEMA,
      }),
    ),
  )

  const validShardResults = checkerResultsRaw.filter(Boolean)
  const droppedShardCount = checkerResultsRaw.length - validShardResults.length
  if (droppedShardCount > 0) {
    log(
      'Warning: ' +
        droppedShardCount +
        ' of ' +
        checkerResultsRaw.length +
        ' shard checker(s) failed or returned nothing. Their files were NOT validated this run; coverage is incomplete for this scan, not silently capped as complete.',
    )
  }

  phase('Aggregate')

  // Ownership matching runs on a shared key, not on raw strings. The scout
  // enumerates each article by its full relative path (for example
  // rolara-kb/characters/archfey/Baba-Yaga.md), but an index claims ownership
  // with an Obsidian short wikilink whose target is only the basename (for
  // example [[Baba-Yaga]]). Comparing a full path against a bare basename never
  // matches, which previously made the single-ownership pass report every
  // article as an unowned orphan. Reduce both sides to the same key first: the
  // lowercased basename with no extension. Obsidian forbids | # ^ [ ] in note
  // names, so stripping a display alias, a heading or block anchor, a folder
  // path, and a trailing .md only ever removes wikilink decoration, never part
  // of a real basename. The project's filename-collision convention keeps
  // basenames unique across folders, so this key does not conflate two distinct
  // articles; any collision that slips through is surfaced below rather than
  // silently merged.
  const toOwnershipKey = (raw) => {
    let s = String(raw).trim()
    s = s.replace(/^\[\[|\]\]$/g, '') // strip [[ ]] if a raw wikilink slipped through
    s = s.replace(/\\\|/g, '|') // unescape a table-escaped pipe (\| -> |)
    s = s.split('|')[0] // drop a wikilink display alias
    s = s.split('#')[0] // drop a heading or block-reference anchor
    s = s.replace(/\\/g, '/').replace(/\/+$/, '') // normalize separators, drop a trailing slash
    const base = s.slice(s.lastIndexOf('/') + 1) // basename
    return base.replace(/\.md$/i, '').trim().toLowerCase() // drop a .md extension
  }

  const allArticles = new Set()
  const articlePathsByKey = new Map()
  const catalogEntries = new Set()
  const ownersByKey = new Map()
  const tagTotals = new Map()
  const mechanicallyFixable = []
  const needsJudgment = []
  let filesChecked = 0

  for (const shard of validShardResults) {
    filesChecked += shard.filesChecked || 0
    for (const a of shard.articles || []) {
      allArticles.add(a)
      const key = toOwnershipKey(a)
      const paths = articlePathsByKey.get(key) || []
      paths.push(a)
      articlePathsByKey.set(key, paths)
    }
    for (const c of shard.catalogEntries || []) catalogEntries.add(c)
    for (const claim of shard.ownershipClaims || []) {
      const key = toOwnershipKey(claim.ownedArticle)
      const owners = ownersByKey.get(key) || []
      owners.push(claim.indexFile)
      ownersByKey.set(key, owners)
    }
    for (const t of shard.tagsUsed || []) {
      tagTotals.set(t.tag, (tagTotals.get(t.tag) || 0) + t.count)
    }
    for (const f of shard.mechanicallyFixable || []) mechanicallyFixable.push(f)
    for (const j of shard.needsJudgment || []) needsJudgment.push(j)
  }

  // The basename key assumes basenames are unique KB-wide, which is the
  // project's filename-collision convention but is not enforced by any hook. If
  // two different article paths reduce to the same key, their owner lists merge
  // and the single-ownership verdict for both becomes unreliable: an orphan can
  // look owned, or one owner can look like several. Surface any such collision
  // so the DM knows those files' ownership results are approximate, instead of
  // trusting a silently merged verdict.
  const basenameCollisions = []
  for (const paths of articlePathsByKey.values()) {
    const distinct = Array.from(new Set(paths))
    if (distinct.length > 1) basenameCollisions.push(distinct)
  }
  if (basenameCollisions.length > 0) {
    log(
      'Warning: ' +
        basenameCollisions.length +
        ' basename collision(s) across folders (for example ' +
        basenameCollisions[0].join(' and ') +
        '). Ownership is matched by basename, the form indexes link to, so single-ownership results for these files may be unreliable. The KB filename convention is meant to keep basenames unique across folders.',
    )
  }

  const singleOwnershipFindings = []
  for (const article of allArticles) {
    // Count distinct owning indexes: an index that happens to list the same
    // article twice is still one owner, not a single-ownership violation, so
    // collapse duplicate index files before counting.
    const owners = Array.from(new Set(ownersByKey.get(toOwnershipKey(article)) || []))
    if (owners.length === 1) continue
    if (owners.length === 0) {
      singleOwnershipFindings.push({
        file: article,
        ruleId: singleOwnershipRuleId,
        description: 'This article is not listed as owned by any index in the KB.',
        question: 'Which index should list ' + article + ', or should a new index be created to own it?',
      })
    } else {
      singleOwnershipFindings.push({
        file: article,
        ruleId: singleOwnershipRuleId,
        description: 'This article is listed as owned by ' + owners.length + ' indexes: ' + owners.join(', ') + '.',
        question: 'Which one of these indexes should own ' + article + ', and should it be removed from the others?',
      })
    }
  }
  for (const finding of singleOwnershipFindings) needsJudgment.push(finding)

  // indexParity, evaluated centrally: no shard sees a whole folder, so group the
  // scout's complete file list by folder and count the index files in each. An
  // index file is one whose basename (extension stripped) ends with the project's
  // indexSuffix, matched case-insensitively to agree with the write-time hook (a
  // mis-cased "-index" still counts as an index). A folder holding more than one
  // is a parity violation; which index survives is the DM's call, so it is a
  // needs-judgment finding, never an auto-fix. With no configured suffix there is
  // no central way to tell an index from an article, so the check is skipped: the
  // scout returns an empty suffix when the project defines no indexParity rule,
  // and an empty suffix would otherwise match every file.
  const indexParityFindings = []
  if (indexSuffix) {
    const suffixLower = indexSuffix.toLowerCase()
    const indexesByFolder = new Map()
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/')
      const lastSlash = normalized.lastIndexOf('/')
      const folder = lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
      const base = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
      const lastDot = base.lastIndexOf('.')
      const stem = lastDot > 0 ? base.slice(0, lastDot) : base
      if (!stem.toLowerCase().endsWith(suffixLower)) continue
      const list = indexesByFolder.get(folder) || []
      list.push(normalized)
      indexesByFolder.set(folder, list)
    }
    for (const [folder, indexes] of indexesByFolder.entries()) {
      if (indexes.length <= 1) continue
      const sortedIndexes = indexes.slice().sort()
      const folderLabel = folder || kbRoot || '(project root)'
      indexParityFindings.push({
        file: folderLabel,
        ruleId: indexParityRuleId,
        description:
          'This folder holds ' +
          indexes.length +
          ' index files: ' +
          sortedIndexes.join(', ') +
          '. Convention allows at most one index per folder.',
        question:
          'Which single index should own ' +
          folderLabel +
          '? Merge the others into it and delete them, or rename the extras so they are no longer index files.',
      })
    }
  }
  for (const finding of indexParityFindings) needsJudgment.push(finding)

  const proposedTagRegistry = {}
  for (const [tag, count] of tagTotals.entries()) proposedTagRegistry[tag] = count

  log(
    'Aggregated ' +
      validShardResults.length +
      ' shard report(s) covering ' +
      allArticles.size +
      ' article(s), ' +
      catalogEntries.size +
      ' of them catalog entries. Found ' +
      mechanicallyFixable.length +
      ' mechanically fixable violation(s) and ' +
      needsJudgment.length +
      ' needs-judgment item(s) (' +
      singleOwnershipFindings.length +
      ' single-ownership, ' +
      indexParityFindings.length +
      ' index-parity).',
  )

  return {
    mode: 'scan',
    conventionsFound: true,
    kbRoot,
    filesScanned: files.length,
    filesChecked,
    shardsChecked: validShardResults.length,
    shardsDropped: droppedShardCount,
    mechanicallyFixable,
    needsJudgment,
    singleOwnershipFindings,
    indexParityFindings,
    proposedTagRegistry,
    tagRegistryPath,
    nextStep:
      'Present the mechanically fixable bucket to the DM for one batch approval (a single yes covers the whole bucket), resolve each needs-judgment item individually (including the single-ownership and index-parity findings), then re-invoke this workflow with args.mode "fix", args.approvedFixes set to the approved subset, and, if the DM approves it, args.approvedTagRegistry set to proposedTagRegistry.',
  }
}

export default await run()
