// validation-sweep: KB-wide convention audit for a professor-orb campaign project.
//
// TWO-PHASE COVENANT (read this before invoking):
//
// This workflow runs in the background and cannot ask the DM anything mid-run,
// so mutation is split into two separate invocations, driven by args.mode:
//
//   1. SCAN phase (default, or args.mode === "scan"): read-only. A project may
//      define more than one setting (conventions.json's v3 settings array; a
//      v1 or v2 file reads as one unnamed setting), each its own vault with
//      its own kbRoot, rules, and tag registry. This phase shards every
//      setting's KB across parallel haiku checkers, aggregates a
//      per-setting singleOwnership pass, and returns one merged report:
//      violations sorted into mechanicallyFixable (exact fix stated) and
//      needsJudgment (exact DM question stated), plus one proposed
//      replacement tag registry per setting. Mutates NOTHING. If
//      .professor-orb/conventions.json is missing, this phase returns a
//      short "setup has not been run" report and does nothing else.
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
//      approvedTagRegistry and tagRegistryPath apply to exactly one setting
//      per invocation: pick one entry from the scan report's
//      proposedTagRegistries and pass its registry and tagRegistryPath. A
//      project with several settings that wants several registries written
//      re-invokes the fix phase once per setting. An entry the scan marked
//      conflict true shares its tagRegistryPath with another setting; because
//      registries are written one per invocation, applying both would leave
//      only the last one on disk, so fix conventions.json first and do not
//      write either.
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
    'KB-wide convention audit for a professor-orb campaign project, aware of every setting the project defines. Scan phase (default) shards each setting\'s knowledge base across parallel haiku checkers, aggregates a per-setting single-ownership pass, and returns a merged report split into mechanically fixable and needs-judgment violations plus a proposed tag registry per setting, mutating nothing. Fix phase (args.mode "fix") applies only the DM-approved fixes passed in args, via dedicated haiku fixer subagents. Invoke by name validation-sweep; pass args.mode and, for the fix phase, args.approvedFixes.',
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

// A v3 conventions.json carries a settings array (each entry its own kbRoot,
// homebrewRoot, sessionReportsRoot, campaigns, rules, tagRegistryPath); a v1
// or v2 file carries a bare top-level kbRoot and rules and reads as one
// unnamed setting. Either way the scout resolves one or more settings, never
// a single global kbRoot, so that shape replaces the old flat kbRoot field
// here: prongRoots is one entry per setting (kind is "kb" for every entry
// today, this workflow's scope; the field exists so a project that later
// gains homebrew or session-report checking does not need a schema change),
// and settingConfigs carries each setting's own rules, tag registry path, and
// index suffix, since those are no longer shared KB-wide either.
//
// Both arrays carry an index: the setting's position in the declared settings
// array. It is the join key between the two arrays and the identity of a
// setting everywhere downstream, because a name is neither unique nor
// guaranteed present. Two v3 entries may share a name or both omit one, and
// identifying settings by name collapses them into one, stranding a whole
// setting's KB unscanned. Declared position is also the order the write-time
// hook resolves ownership in, which this sweep has to agree with.
const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    conventionsFound: { type: 'boolean' },
    prongRoots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'number' },
          setting: { type: 'string' },
          kind: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['index', 'setting', 'kind', 'path'],
      },
    },
    settingConfigs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'number' },
          setting: { type: 'string' },
          rulesJson: { type: 'string' },
          tagRegistryPath: { type: 'string' },
          indexSuffix: { type: 'string' },
        },
        required: ['index', 'setting', 'rulesJson'],
      },
    },
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
  'Step 2: If conventions.json is present and valid, resolve it into one or more settings, and give each one an index: its zero-based position in the declared list of settings. The index, not the name, is how the rest of this sweep identifies a setting, because two settings may share a name or both omit one. If the file has a non-empty top-level "settings" array (a v3 file), each entry in that array is one setting, and its index is its position in that array (the first entry is index 0, the second is index 1, and so on). For each such entry: its name is entry.name if that is a non-empty string, otherwise use the empty string "" as its name; its KB root is entry.kbRoot, reported exactly as conventions.json records it (do not rewrite it into an absolute path); its rules are entry.rules; and its tag registry path is resolved in this exact order, stopping at the first one that is a non-empty string: entry.tagRegistryPath, then the file\'s TOP-LEVEL tagRegistryPath, then ".professor-orb/tag-registry.json". That three-step order is the order the write-time validator hook applies, and the sweep must land on the same registry file the hook validates against, or it will propose rewriting a file the hook never reads. Skip any settings-array entry whose kbRoot is not a string; it cannot be enumerated. Skipping one does not renumber the others: every index stays equal to the entry\'s position in the settings array, so a skipped entry leaves a gap. Otherwise, if the file has a top-level "kbRoot" string and a top-level "rules" object (a v1 or v2 file), treat the whole file as exactly one setting with index 0: name "", KB root from the top-level kbRoot, tag registry path from the top-level tagRegistryPath falling back to the same default, rules from the top-level rules. For each setting resolved this way, look through that setting\'s own rules object for any rule whose check is "indexParity" and note its params.indexSuffix (for example "-INDEX"); if no such rule exists for that setting, use an empty string for that setting\'s indexSuffix.',
  '',
  'Step 3: For every setting resolved in Step 2, enumerate every markdown article file under that setting\'s KB root, recursively, using paths relative to the project root (the same root conventions.json itself is relative to), for example "world-of-rolara-kb/npcs/thoric-brightaxe.md". Do not include conventions.json, any tag registry file, or non-markdown files. If two settings\' KB roots happen to overlap or nest, still list each file once in your total answer, not once per setting whose root contains it.',
  '',
  'Return: conventionsFound (true), prongRoots (one entry per setting resolved in Step 2, each {index: that setting\'s index from Step 2, setting: its name, kind: "kb", path: that setting\'s KB root}), settingConfigs (one entry per setting resolved in Step 2, each {index: the same index you gave it in prongRoots, setting: its name, rulesJson (the exact rules object for that setting, re-serialized as a JSON string, verbatim: every rule it defines, nothing summarized or dropped), tagRegistryPath, indexSuffix}), files (the full array of relative markdown file paths across every setting\'s KB root, each file listed once), message (empty string when conventions were found). The index is what ties a prongRoots entry to its settingConfigs entry, so the two arrays must use the same index for the same setting.',
].join('\n')

// Check semantics are duplicated four ways: skills/setup/references/conventions-schema.md's
// check catalog (normative), the CHECKS table in hooks/validate-write.mjs, this prompt, and
// agents/kb-validator.md Step 4. The base rule data is single-sourced at
// references/base-rules.json; the semantics are not. Changing one requires changing the
// other three.
const checkerPrompt = (shardFiles, shardIdx, setting, kbRoot, rulesJson, indexSuffix) =>
  [
    'You are checker shard ' +
      shardIdx +
      ' of a knowledge base validation sweep for a D&D campaign project' +
      (setting ? ', covering the "' + setting + '" setting' : '') +
      '. Check ONLY the files listed below against the project conventions given below. Do not check, open, or report on any other file.',
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
    '3. Decide whether it is a catalog entry: frontmatter type is exactly one of spell, magic-item, feat, feature, monster, npc, species, subclass, class, other (lowercase, matched case-sensitively, so a KB article of type "Species" is NOT a catalog entry while a homebrew entry of type "species" is). Catalog entries ARE subject to index ownership checks (a real index should still list them), but are EXEMPT from wikilink and orphan checks: never flag a catalog entry for having no outgoing wikilinks or for not being linked to from other article bodies. That is correct structure for a catalog entry, not a violation.',
    'Before checking anything: skip every rule whose enforcement is "off". The DM turned it off deliberately, and off is the only lever they have over a rule professor-orb ships rather than one they wrote. An off rule produces no finding of any kind, and in particular never a mechanicallyFixable one, because that bucket is applied wholesale on a single approval.',
    'A rule may carry extendedBy, an array of additional permitted values contributed by the project. Treat params.values and extendedBy as one combined list; a value in either is valid.',
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
      proposedTagRegistries: [],
      tagRegistryConflicts: [],
      // Present on every scan-phase shape, so an empty findings bucket can
      // never be read as a clean KB without also reading how much of it was
      // actually attributed to a setting and checked. Nothing was enumerated
      // on this path, so nothing could be left unattributed.
      // unattributedSample is a slice(0, 20), never the full miss list, so its
      // name cannot be mistaken for the true count: read filesUnattributed for
      // that.
      filesUnattributed: 0,
      unattributedSample: [],
    }
  }

  const prongRoots = Array.isArray(scout.prongRoots) ? scout.prongRoots : []
  const files = Array.isArray(scout.files) ? scout.files : []
  const settingConfigsRaw = Array.isArray(scout.settingConfigs) ? scout.settingConfigs : []

  // Every root-versus-file prefix test runs both sides through this. File
  // paths come back from the scout project-relative, but a kbRoot can be
  // recorded as "rolara-kb", "./rolara-kb", "/rolara-kb", or "rolara-kb/".
  // Normalizing only one side (what shipped before: leading slashes stripped
  // from the file, trailing slashes from the root) makes three of those four
  // forms match nothing at all, and since kbRoot became load-bearing for
  // attribution, every file under such a root is then silently never checked.
  // A root recorded as an absolute path still cannot match here, because this
  // workflow never learns the project root that would make it relative; the
  // unattributed count in the returned report is what surfaces that case.
  const normalizeRel = (p) =>
    String(p == null ? '' : p)
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')

  // One entry per setting: its own rules (parsed once), its own
  // singleOwnership and indexParity rule ids, its own tag registry path and
  // index suffix, and (filled in just below from prongRoots) its own kbRoot.
  //
  // Keyed by a unique setting key derived from the setting's declared index,
  // NOT by its name. Two v3 entries can share a name, or both omit one (the
  // scout reports a missing name as ""), and a name-keyed map collapses them
  // into a single entry holding whichever kbRoot was seen last. Every file
  // under the other root then fails attribution, lands in the unattributed
  // pile, and is never sharded or checked: a whole setting's KB silently
  // dropped. Nothing upstream prevents duplicate names, since the hook's own
  // resolveSettings does not dedupe either. A scout that omits or repeats an
  // index falls back to a positional key, which is unique by construction and
  // can never equal a numeric one.
  const settingConfigs = new Map()
  const freeKey = (preferred, fallback) => {
    if (preferred !== null && !settingConfigs.has(preferred)) return preferred
    let candidate = fallback
    let n = 2
    while (settingConfigs.has(candidate)) candidate = fallback + '-' + n++
    return candidate
  }

  settingConfigsRaw.forEach((sc, position) => {
    if (!sc || typeof sc !== 'object') return
    const name = typeof sc.setting === 'string' ? sc.setting : ''
    let rules = {}
    try {
      rules = JSON.parse(sc.rulesJson || '{}')
    } catch (err) {
      log(
        'Warning: the rules JSON returned by the scout for setting "' +
          (name || '(unnamed)') +
          '" could not be parsed; proceeding with an empty rule set for that setting. ' +
          err.message,
      )
      rules = {}
    }
    if (!rules || typeof rules !== 'object') rules = {}
    let singleOwnershipRuleId = 'singleOwnership'
    for (const ruleId of Object.keys(rules)) {
      if (rules[ruleId] && rules[ruleId].check === 'singleOwnership') {
        singleOwnershipRuleId = ruleId
        break
      }
    }
    // indexParity is a whole-folder rule, so like singleOwnership no single
    // shard can judge it: a shard sees only its slice of a folder, never the
    // folder's full file list. It is evaluated centrally in the Aggregate
    // phase below, per setting, from the scout's complete enumeration.
    // Discover its rule id the same way, so the finding carries the
    // setting's own rule name (for example structuralIndexParity).
    let indexParityRuleId = 'indexParity'
    for (const ruleId of Object.keys(rules)) {
      if (rules[ruleId] && rules[ruleId].check === 'indexParity') {
        indexParityRuleId = ruleId
        break
      }
    }
    const key = freeKey(Number.isInteger(sc.index) ? String(sc.index) : null, 'setting-' + position)
    settingConfigs.set(key, {
      key,
      declaredIndex: Number.isInteger(sc.index) ? sc.index : Number.MAX_SAFE_INTEGER,
      setting: name,
      kbRoot: '',
      rules,
      singleOwnershipRuleId,
      indexParityRuleId,
      indexSuffix: sc.indexSuffix || '',
      tagRegistryPath: sc.tagRegistryPath || '.professor-orb/tag-registry.json',
    })
  })

  prongRoots.forEach((root, position) => {
    if (!root || typeof root !== 'object' || root.kind !== 'kb') return
    const preferred = Number.isInteger(root.index) ? String(root.index) : null
    const existing = preferred !== null ? settingConfigs.get(preferred) : undefined
    const rootSetting = typeof root.setting === 'string' ? root.setting : ''
    // The index alone is not proof the two arrays agree on which setting it
    // names: the scout reports prongRoots and settingConfigs separately, and
    // a scout that numbers them inconsistently would otherwise join one
    // setting's KB root to a different setting's rules, silently checking
    // every article under that root against the wrong rule set. Filling a
    // blank name (either side left it "") is the legitimate case and still
    // joins; two non-empty names that disagree do not.
    const nameMismatch = Boolean(existing && existing.setting && rootSetting && existing.setting !== rootSetting)
    if (existing && !existing.kbRoot && !nameMismatch) {
      existing.kbRoot = root.path || ''
      if (!existing.setting && rootSetting) existing.setting = rootSetting
      return
    }
    // No settingConfigs entry carries this index, one does and its kbRoot is
    // already filled (two prongRoots entries claiming the same index), or one
    // does but its declared name disagrees with this root's declared name.
    // None of those are joined; this root gets its own entry either way, it
    // never overwrites or is paired with an entry already recorded, because
    // doing either is precisely how one setting's KB goes unscanned or ends
    // up checked against another setting's rules.
    if (nameMismatch) {
      log(
        'Warning: prongRoots index ' +
          root.index +
          ' is named "' +
          rootSetting +
          '" but settingConfigs index ' +
          root.index +
          ' is named "' +
          existing.setting +
          '". The scout numbered the two reported arrays inconsistently for this index, so they do not describe the same setting and are not joined: pairing them would check "' +
          rootSetting +
          '"\'s KB root against "' +
          existing.setting +
          '"\'s rules. Tracking this KB root as its own setting with no rules instead, so its files are still enumerated and reported rather than silently validated against the wrong conventions. Re-run the scan.',
      )
    } else if (existing) {
      log(
        'Warning: the scout returned more than one KB root for setting index ' +
          root.index +
          ' ("' +
          (rootSetting || '(unnamed)') +
          '" at ' +
          (root.path || '(no path)') +
          '). Tracking it as a separate setting with no rules rather than overwriting the root already recorded, so its files are still enumerated and reported.',
      )
    }
    const key = freeKey(existing ? null : preferred, 'root-' + position)
    settingConfigs.set(key, {
      key,
      declaredIndex: Number.isInteger(root.index) ? root.index : Number.MAX_SAFE_INTEGER,
      setting: rootSetting,
      kbRoot: root.path || '',
      rules: {},
      singleOwnershipRuleId: 'singleOwnership',
      indexParityRuleId: 'indexParity',
      indexSuffix: '',
      tagRegistryPath: '.professor-orb/tag-registry.json',
    })
  })

  // Declared order, because that is the order the write-time hook resolves
  // ownership in. Array.prototype.sort is stable, so settings the scout gave
  // no usable index keep the order it returned them in.
  const orderedConfigs = Array.from(settingConfigs.values()).sort((a, b) => a.declaredIndex - b.declaredIndex)

  const nameCounts = new Map()
  for (const cfg of orderedConfigs) {
    const label = cfg.setting || '(unnamed)'
    nameCounts.set(label, (nameCounts.get(label) || 0) + 1)
  }
  const duplicateNames = Array.from(nameCounts.entries())
    .filter(([, n]) => n > 1)
    .map(([label]) => label)
  if (duplicateNames.length > 0) {
    log(
      'Note: ' +
        duplicateNames.length +
        ' setting name(s) are shared by more than one setting (' +
        duplicateNames.join(', ') +
        '). Each setting is tracked separately by its declared position, so no setting\'s files are dropped, but any report entry that names a setting is ambiguous between them. Give each setting a distinct name in .professor-orb/conventions.json.',
    )
  }

  // Two settings whose KB roots nest, or coincide, is a misconfiguration: every
  // file under the inner root is also under the outer one, so only the first
  // setting in declared order can ever own it, and the inner setting's rules
  // are never applied to anything. Neither this sweep nor the write-time hook
  // surfaces that today, so say it out loud.
  const nestedRootPairs = []
  for (let i = 0; i < orderedConfigs.length; i++) {
    for (let j = i + 1; j < orderedConfigs.length; j++) {
      const a = normalizeRel(orderedConfigs[i].kbRoot)
      const b = normalizeRel(orderedConfigs[j].kbRoot)
      if (!a || !b) continue
      if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) {
        nestedRootPairs.push(
          '"' +
            (orderedConfigs[i].setting || '(unnamed)') +
            '" at ' +
            orderedConfigs[i].kbRoot +
            ' and "' +
            (orderedConfigs[j].setting || '(unnamed)') +
            '" at ' +
            orderedConfigs[j].kbRoot,
        )
      }
    }
  }
  if (nestedRootPairs.length > 0) {
    log(
      'Warning: ' +
        nestedRootPairs.length +
        ' pair(s) of setting KB roots nest or coincide (' +
        nestedRootPairs.join('; ') +
        '). A file inside both is owned by whichever setting is declared first, here and in the write-time hook alike, so the other setting\'s rules never reach it. Give each setting a root that contains no other setting\'s root.',
    )
  }

  // Which setting owns a file: the FIRST setting in declared order whose KB
  // root contains it, breaking on the first match. That is exactly what the
  // write-time hook does (hooks/validate-write.mjs walks the settings array in
  // order and breaks on the first prong containing the file), and the sweep
  // has to reach the same owner for the same file or the two sides validate it
  // against different rule sets, which is the divergence this whole path
  // exists to remove. Longest-root ("most specific wins") is arguably the
  // better rule on its own merits, but it is not the rule the hook applies,
  // and changing it means changing both sides together.
  //
  // Every file the scout returned came from walking a setting's kbRoot in Step
  // 3 of scoutPrompt, so this should always resolve; the null fallback catches
  // a scout that returned a file outside every root it was told to enumerate,
  // and a kbRoot recorded in a form no relative path can match.
  const settingForFile = (file) => {
    const normalized = normalizeRel(file)
    for (const cfg of orderedConfigs) {
      const raw = String(cfg.kbRoot == null ? '' : cfg.kbRoot).trim()
      if (!raw) continue
      const root = normalizeRel(raw)
      // A root of "." or "./" is the project root itself, which contains every
      // file. That is what the hook's path.resolve(projectRoot, ".") yields,
      // so it has to mean the same thing here.
      if (root === '' || root === '.') return cfg.key
      if (normalized === root || normalized.startsWith(root + '/')) return cfg.key
    }
    return null
  }

  const filesBySetting = new Map()
  const unattributedFiles = []
  for (const f of files) {
    const settingKey = settingForFile(f)
    if (settingKey === null) {
      unattributedFiles.push(f)
      continue
    }
    const list = filesBySetting.get(settingKey) || []
    list.push(f)
    filesBySetting.set(settingKey, list)
  }
  if (unattributedFiles.length > 0) {
    log(
      'Warning: ' +
        unattributedFiles.length +
        ' of ' +
        files.length +
        " file(s) returned by the scout did not fall under any resolved setting's KB root and were NOT checked: " +
        unattributedFiles.slice(0, 5).join(', ') +
        (unattributedFiles.length > 5 ? ', ...' : '') +
        '. The roots they were tested against were: ' +
        orderedConfigs.map((c) => '"' + (c.setting || '(unnamed)') + '" at ' + (c.kbRoot || '(none)')).join(', ') +
        '. A kbRoot recorded as an absolute path cannot match a project-relative file path and strands every file beneath it.',
    )
  }

  if (files.length === 0) {
    log("Scout found conventions.json but no markdown article files under any setting's kbRoot. Nothing to check.")
    return {
      mode: 'scan',
      conventionsFound: true,
      settings: orderedConfigs.map((cfg) => ({ settingKey: cfg.key, setting: cfg.setting, kbRoot: cfg.kbRoot })),
      filesScanned: 0,
      shardsChecked: 0,
      shardsDropped: 0,
      mechanicallyFixable: [],
      needsJudgment: [],
      singleOwnershipFindings: [],
      indexParityFindings: [],
      proposedTagRegistries: [],
      tagRegistryConflicts: [],
      filesUnattributed: unattributedFiles.length,
      unattributedSample: unattributedFiles.slice(0, 20),
      nextStep:
        "No KB articles were found under any setting's kbRoot. Confirm each setting's kbRoot in .professor-orb/conventions.json points at the right folder.",
    }
  }

  phase('Check')

  const shardDescriptors = []
  for (const [settingKey, settingFiles] of filesBySetting.entries()) {
    for (let i = 0; i < settingFiles.length; i += shardSize) {
      shardDescriptors.push({ settingKey, files: settingFiles.slice(i, i + shardSize) })
    }
  }
  log(
    'Partitioned ' +
      files.length +
      ' KB file(s) across ' +
      filesBySetting.size +
      ' setting(s) into ' +
      shardDescriptors.length +
      ' shard(s) of up to ' +
      shardSize +
      ' file(s) each.',
  )

  const checkerResultsRaw = await parallel(
    shardDescriptors.map((shard, shardIdx) => () => {
      const cfg = settingConfigs.get(shard.settingKey) || { setting: '', kbRoot: '', rules: {}, indexSuffix: '' }
      // The checker is given the setting's display NAME, which is only ever
      // prose in its prompt; shard.settingKey is the identity the aggregation
      // below joins on.
      return agent(
        checkerPrompt(shard.files, shardIdx, cfg.setting, cfg.kbRoot, JSON.stringify(cfg.rules), cfg.indexSuffix),
        {
          model: 'haiku',
          label: 'check:shard-' + shardIdx,
          phase: 'Check',
          schema: CHECKER_SCHEMA,
        },
      )
    }),
  )

  // Pairs, not a bare filter: a dropped shard must not desynchronize which
  // setting a surviving result belongs to, and filter(Boolean) alone would
  // have discarded the index that ties each result back to its shard.
  const validShardPairs = shardDescriptors
    .map((shard, i) => ({ shard, result: checkerResultsRaw[i] }))
    .filter((p) => Boolean(p.result))
  const droppedShardCount = shardDescriptors.length - validShardPairs.length
  if (droppedShardCount > 0) {
    log(
      'Warning: ' +
        droppedShardCount +
        ' of ' +
        shardDescriptors.length +
        ' shard checker(s) failed or returned nothing. Their files were NOT validated this run; coverage is incomplete for this scan, not silently capped as complete.',
    )
  }

  phase('Aggregate')

  // Ownership matching runs on a shared key, not on raw strings. The scout
  // enumerates each article by its full relative path (for example
  // world-of-rolara-kb/characters/archfey/Baba-Yaga.md), but an index claims
  // ownership with an Obsidian short wikilink whose target is only the
  // basename (for example [[Baba-Yaga]]). Comparing a full path against a
  // bare basename never matches, which previously made the single-ownership
  // pass report every article as an unowned orphan. Reduce both sides to the
  // same key first: the setting key, then the lowercased basename with no
  // extension. Obsidian forbids | # ^ [ ] in note names, so stripping a
  // display alias, a heading or block anchor, a folder path, and a trailing
  // .md only ever removes wikilink decoration, never part of a real
  // basename. The setting prefix is what keeps two settings' Tavern.md from
  // colliding: each setting is its own vault boundary, so the KB filename
  // convention only has to hold basenames unique within one setting, never
  // across all of them. The prefix is the setting's unique KEY (its declared
  // index), never its display name, because two settings are allowed to share
  // a name and a name-prefixed key would merge their vaults right back
  // together. A falsy key adds no prefix, which only a caller passing one
  // explicitly can produce; every key this workflow generates is truthy.
  const toOwnershipKey = (raw, setting) => {
    let s = String(raw).trim()
    s = s.replace(/^\[\[|\]\]$/g, '') // strip [[ ]] if a raw wikilink slipped through
    s = s.replace(/\\\|/g, '|') // unescape a table-escaped pipe (\| -> |)
    s = s.split('|')[0] // drop a wikilink display alias
    s = s.split('#')[0] // drop a heading or block-reference anchor
    s = s.replace(/\\/g, '/').replace(/\/+$/, '') // normalize separators, drop a trailing slash
    const base = s.slice(s.lastIndexOf('/') + 1) // basename
    return (setting ? setting + '/' : '') + base.replace(/\.md$/i, '').trim().toLowerCase() // drop a .md extension
  }

  const allArticles = new Set()
  const articleSettingByPath = new Map()
  const articlePathsByKey = new Map()
  const catalogEntries = new Set()
  const ownersByKey = new Map()
  const tagTotalsBySetting = new Map()
  const mechanicallyFixable = []
  const needsJudgment = []
  let filesChecked = 0

  for (const { shard, result } of validShardPairs) {
    filesChecked += result.filesChecked || 0
    for (const a of result.articles || []) {
      allArticles.add(a)
      articleSettingByPath.set(a, shard.settingKey)
      const key = toOwnershipKey(a, shard.settingKey)
      const paths = articlePathsByKey.get(key) || []
      paths.push(a)
      articlePathsByKey.set(key, paths)
    }
    for (const c of result.catalogEntries || []) catalogEntries.add(c)
    for (const claim of result.ownershipClaims || []) {
      const key = toOwnershipKey(claim.ownedArticle, shard.settingKey)
      const owners = ownersByKey.get(key) || []
      owners.push(claim.indexFile)
      ownersByKey.set(key, owners)
    }
    const tagTotals = tagTotalsBySetting.get(shard.settingKey) || new Map()
    for (const t of result.tagsUsed || []) {
      tagTotals.set(t.tag, (tagTotals.get(t.tag) || 0) + t.count)
    }
    tagTotalsBySetting.set(shard.settingKey, tagTotals)
    for (const f of result.mechanicallyFixable || []) mechanicallyFixable.push(f)
    for (const j of result.needsJudgment || []) needsJudgment.push(j)
  }

  // The setting-scoped key assumes basenames are unique within a setting,
  // which is the project's filename-collision convention but is not enforced
  // by any hook. If two different article paths in the same setting reduce
  // to the same key, their owner lists merge and the single-ownership
  // verdict for both becomes unreliable: an orphan can look owned, or one
  // owner can look like several. Surface any such collision so the DM knows
  // those files' ownership results are approximate, instead of trusting a
  // silently merged verdict. Two settings sharing a basename is not a
  // collision at all now, that is the entire point of the setting prefix, so
  // this can only fire within one setting.
  const basenameCollisions = []
  for (const paths of articlePathsByKey.values()) {
    const distinct = Array.from(new Set(paths))
    if (distinct.length > 1) basenameCollisions.push(distinct)
  }
  if (basenameCollisions.length > 0) {
    log(
      'Warning: ' +
        basenameCollisions.length +
        ' basename collision(s) within a setting (for example ' +
        basenameCollisions[0].join(' and ') +
        '). Ownership is matched by basename within a setting, the form indexes link to, so single-ownership results for these files may be unreliable. The KB filename convention is meant to keep basenames unique within a setting.',
    )
  }

  // Shard workers are told to skip every rule whose enforcement is "off" (see
  // the checkerPrompt line above step 4), but they are also told NOT to
  // evaluate singleOwnership themselves (step 7): it needs the whole KB, so
  // it is computed here instead. That means the shard-level skip-off
  // instruction never reaches this check; without a matching guard here, an
  // "off" singleOwnership rule would still produce findings on this path.
  // Absent is not off: only the literal string "off" suppresses. Evaluated
  // per article's own setting, since enforcement is a per-setting rule
  // choice.
  const singleOwnershipFindings = []
  for (const article of allArticles) {
    const settingKey = articleSettingByPath.get(article)
    const cfg = settingConfigs.get(settingKey)
    const ruleId = (cfg && cfg.singleOwnershipRuleId) || 'singleOwnership'
    const off = Boolean(cfg && cfg.rules[ruleId] && cfg.rules[ruleId].enforcement === 'off')
    if (off) continue
    // Count distinct owning indexes: an index that happens to list the same
    // article twice is still one owner, not a single-ownership violation, so
    // collapse duplicate index files before counting.
    const owners = Array.from(new Set(ownersByKey.get(toOwnershipKey(article, settingKey)) || []))
    if (owners.length === 1) continue
    if (owners.length === 0) {
      singleOwnershipFindings.push({
        file: article,
        ruleId,
        description: 'This article is not listed as owned by any index in the KB.',
        question: 'Which index should list ' + article + ', or should a new index be created to own it?',
      })
    } else {
      singleOwnershipFindings.push({
        file: article,
        ruleId,
        description: 'This article is listed as owned by ' + owners.length + ' indexes: ' + owners.join(', ') + '.',
        question: 'Which one of these indexes should own ' + article + ', and should it be removed from the others?',
      })
    }
  }
  for (const finding of singleOwnershipFindings) needsJudgment.push(finding)

  // indexParity, evaluated centrally per setting: no shard sees a whole
  // folder, so group each setting's own file list by folder and count the
  // index files in each. Grouping per setting, not across the whole scan,
  // keeps two settings that happen to share a folder name (for example both
  // having an "npcs" folder) from being compared against each other; they
  // are different vaults. An index file is one whose basename (extension
  // stripped) ends with that setting's indexSuffix, matched
  // case-insensitively to agree with the write-time hook (a mis-cased
  // "-index" still counts as an index). A folder holding more than one is a
  // parity violation; which index survives is the DM's call, so it is a
  // needs-judgment finding, never an auto-fix. With no configured suffix for
  // a setting there is no central way to tell an index from an article in
  // that setting, so the check is skipped for it: the scout returns an empty
  // suffix when a setting defines no indexParity rule, and an empty suffix
  // would otherwise match every file.
  const indexParityFindings = []
  for (const [settingKey, settingFiles] of filesBySetting.entries()) {
    const cfg = settingConfigs.get(settingKey)
    if (!cfg || !cfg.indexSuffix) continue
    // Same reasoning as the singleOwnership guard above: indexParity is also
    // a whole-KB check the shard prompt explicitly excludes from shard
    // evaluation (step 7), so the shard-level skip-off instruction cannot
    // cover it either; this guard is the only thing that can. Absent is not
    // off.
    const off = Boolean(cfg.rules[cfg.indexParityRuleId] && cfg.rules[cfg.indexParityRuleId].enforcement === 'off')
    if (off) continue
    const suffixLower = cfg.indexSuffix.toLowerCase()
    const indexesByFolder = new Map()
    for (const file of settingFiles) {
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
      const folderLabel = folder || cfg.kbRoot || '(project root)'
      indexParityFindings.push({
        file: folderLabel,
        ruleId: cfg.indexParityRuleId,
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

  // One proposed registry per setting: a v3 project's settings each carry
  // their own tag vocabulary and their own tagRegistryPath, so one world's
  // tags are never proposed as an addition to another world's registry.
  const proposedTagRegistries = []
  for (const [settingKey, tagTotals] of tagTotalsBySetting.entries()) {
    const registry = {}
    for (const [tag, count] of tagTotals.entries()) registry[tag] = count
    const cfg = settingConfigs.get(settingKey)
    proposedTagRegistries.push({
      settingKey,
      setting: (cfg && cfg.setting) || '',
      tagRegistryPath: (cfg && cfg.tagRegistryPath) || '.professor-orb/tag-registry.json',
      registry,
    })
  }

  // Two settings can still land on the same tagRegistryPath: v3 entries that
  // both omit tagRegistryPath fall back to the file's top-level one, or to the
  // shared default. The fix phase writes exactly one registry per invocation
  // and the nextStep below tells the DM to apply them one at a time, so two
  // proposals for one path would leave only the last written, and the hook
  // would then validate one setting's articles against a vocabulary missing
  // every tag of its own. Surface it as a needs-judgment item, the bucket the
  // DM resolves individually, and mark the entries so no part of the fix phase
  // can be handed one blind.
  const tagRegistryConflicts = []
  const registriesByPath = new Map()
  for (const entry of proposedTagRegistries) {
    // Grouped by normalized path, not the raw string: ".professor-orb/tag-
    // registry.json" and "./.professor-orb/tag-registry.json" are the same
    // file on disk, and two settings resolving to those two spellings still
    // clobber each other on write. Keying on the raw string leaves them in
    // separate groups of one, and the conflict this guard exists to catch
    // never fires.
    const groupKey = normalizeRel(entry.tagRegistryPath)
    const group = registriesByPath.get(groupKey) || []
    group.push(entry)
    registriesByPath.set(groupKey, group)
  }
  for (const group of registriesByPath.values()) {
    if (group.length <= 1) continue
    // The map key above is normalized for comparison only; the DM never
    // typed that normalized form, so the reported path is the literal value
    // an entry actually carries, exactly as it appears in conventions.json.
    const registryPath = group[0].tagRegistryPath
    const names = group.map((e) => e.setting || '(unnamed)')
    const distinctContents = new Set(group.map((e) => JSON.stringify(e.registry)))
    for (const entry of group) entry.conflict = true
    tagRegistryConflicts.push({ tagRegistryPath: registryPath, settings: names, contentsDiffer: distinctContents.size > 1 })
    // This item flags a conventions.json misconfiguration (two settings
    // sharing one tagRegistryPath), not a violation found in a KB article, so
    // it does not carry a real ruleId or an article path the way every other
    // needsJudgment item does. kind marks that explicitly rather than letting
    // file/ruleId masquerade as ones a caller could look up: file stays
    // (still useful to show the DM which path collides), ruleId is null
    // rather than the fake literal string "tagRegistryPath" the earlier
    // version used, since that string is not a rule id in anyone's rules
    // object and grouping or looking it up as one would be wrong.
    needsJudgment.push({
      kind: 'tagRegistryConflict',
      file: registryPath,
      ruleId: null,
      description:
        group.length +
        ' settings (' +
        names.join(', ') +
        ') resolve to the same tag registry path "' +
        registryPath +
        '"' +
        (distinctContents.size > 1
          ? ', and their proposed registries hold different tags'
          : ', and their proposed registries happen to be identical on this run') +
        '. The fix phase writes one registry per invocation, so applying these one at a time leaves only the last one on disk.',
      question:
        'Which setting should own "' +
        registryPath +
        '"? Give the other setting(s) their own tagRegistryPath in .professor-orb/conventions.json, then re-run the scan. Do not approve a tag registry write for any of these settings until each has a distinct path.',
    })
  }
  if (tagRegistryConflicts.length > 0) {
    log(
      'Warning: ' +
        tagRegistryConflicts.length +
        ' tag registry path(s) are claimed by more than one setting. Those proposals carry conflict true and must not be written until each setting has its own path; writing them one at a time would leave only the last one on disk.',
    )
  }

  log(
    'Aggregated ' +
      validShardPairs.length +
      ' shard report(s) across ' +
      filesBySetting.size +
      ' setting(s), covering ' +
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
  if (needsJudgment.length > 0) {
    log(
      needsJudgment.length +
        ' needs-judgment item(s) carry a question each. /migrate offers this bucket as a scope when it is invoked with no argument, so these can be resolved as one approved structural change rather than one at a time by hand.',
    )
  }

  // A file that matched no setting root reaches the DM as a number, not just a
  // log line. Dropped shards already had shardsDropped; unattributed files had
  // nothing, so a scan where every file failed attribution ran zero checkers
  // and returned two empty buckets that read exactly like a clean KB.
  const unattributedNote =
    unattributedFiles.length > 0
      ? 'WARNING: ' +
        unattributedFiles.length +
        ' of ' +
        files.length +
        " file(s) fell under no setting's kbRoot and were never checked, so this report says nothing at all about them. " +
        (filesBySetting.size === 0
          ? 'No file matched any setting root, so no checker ran: the empty buckets in this report are silence, not a clean bill of health. '
          : '') +
        "Fix each setting's kbRoot in .professor-orb/conventions.json (it must be a path relative to the project root, not an absolute one) and re-run the scan. "
      : ''
  const conflictNote =
    tagRegistryConflicts.length > 0
      ? 'WARNING: ' +
        tagRegistryConflicts.length +
        ' tag registry path(s) are claimed by more than one setting; those proposedTagRegistries entries carry conflict true. Do not approve a tag registry write for any of them until each setting has its own tagRegistryPath, because the fix phase writes one registry per invocation and the second would overwrite the first. '
      : ''

  return {
    mode: 'scan',
    conventionsFound: true,
    settings: orderedConfigs.map((cfg) => ({ settingKey: cfg.key, setting: cfg.setting, kbRoot: cfg.kbRoot })),
    filesScanned: files.length,
    filesChecked,
    filesUnattributed: unattributedFiles.length,
    unattributedSample: unattributedFiles.slice(0, 20),
    shardsChecked: validShardPairs.length,
    shardsDropped: droppedShardCount,
    mechanicallyFixable,
    needsJudgment,
    singleOwnershipFindings,
    indexParityFindings,
    proposedTagRegistries,
    tagRegistryConflicts,
    nextStep:
      unattributedNote +
      conflictNote +
      'Present the mechanically fixable bucket to the DM for one batch approval (a single yes covers the whole bucket), resolve each needs-judgment item individually (including the single-ownership and index-parity findings), then re-invoke this workflow with args.mode "fix", args.approvedFixes set to the approved subset, and, if the DM approves it for one setting at a time, args.approvedTagRegistry set to that setting\'s entry from proposedTagRegistries and args.tagRegistryPath set to that entry\'s tagRegistryPath. The needs-judgment bucket is also what /migrate takes as a scope: invoking it with no argument offers this bucket directly, so an ownership conflict or a multi-index folder can be resolved as a structural change rather than by hand.',
  }
}

export default await run()
