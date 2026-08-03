// Regression guard for the single-ownership aggregation, the tag-registry
// conflict guard, and the deterministic enumeration/claims-extraction pipeline
// in validation-sweep.mjs.
//
// The workflow module cannot be imported directly: it uses top-level await and
// workflow-runtime globals (agent, parallel, phase, log, args), so importing it
// would execute run() and throw. This test therefore mirrors the aggregation
// logic. aggregateOld reproduces the historical bug (shipped through 1.5.0);
// aggregateNew mirrors the shipped fix. Keep toOwnershipKey, aggregateNew,
// aggregateSingleOwnershipFixed, normalizeRel, detectTagRegistryConflicts,
// isIndexFile, parseClaimLine, claimsFromLines, and sliceRanges byte-aligned
// with the corresponding sections of validation-sweep.mjs: if you change that
// logic in the source, change it here too, or this guard drifts. A mirror
// that claims a correspondence it no longer has is worse than no mirror,
// because the whole value of this suite rests on the claim being true.
//
// Run: node professor-orb/workflows/validation-sweep.ownership.test.mjs

// Shared key. Must match toOwnershipKey in validation-sweep.mjs exactly.
// Its second argument is the setting's unique KEY (its declared index in
// conventions.json's settings array), never its display name: two settings are
// allowed to share a name, and a name-prefixed key would merge their vaults.
const toOwnershipKey = (raw, setting) => {
  let s = String(raw).trim()
  s = s.replace(/^\[\[|\]\]$/g, '')
  s = s.replace(/\\\|/g, '|')
  s = s.split('|')[0]
  s = s.split('#')[0]
  s = s.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = s.slice(s.lastIndexOf('/') + 1)
  return (setting ? setting + '/' : '') + base.replace(/\.md$/i, '').trim().toLowerCase()
}

// OLD logic: the owners map is keyed by the raw claim target (a bare basename)
// but looked up by the article's full relative path. A full path never equals a
// bare basename, so every lookup misses and every article reads as a 0-owner
// orphan. This is the bug being fixed.
function aggregateOld(shards) {
  const allArticles = new Set()
  const ownersByArticle = new Map()
  for (const shard of shards) {
    for (const a of shard.articles || []) allArticles.add(a)
    for (const c of shard.ownershipClaims || []) {
      const owners = ownersByArticle.get(c.ownedArticle) || []
      owners.push(c.indexFile)
      ownersByArticle.set(c.ownedArticle, owners)
    }
  }
  const findings = []
  for (const a of allArticles) {
    const owners = ownersByArticle.get(a) || []
    if (owners.length !== 1) findings.push({ file: a, ownerCount: owners.length })
  }
  return { findings }
}

// The shard fold, mirroring the `for (const { shard, result } of validShardPairs)`
// loop in the source. Each shard descriptor carries the key of the one setting
// it covers (shard.settingKey), so every key built here is setting-scoped, and
// articleSettingByPath is what lets the per-article passes below recover which
// setting an article came from: the merged allArticles set carries no setting
// information once shards are flattened into it.
function collectOwnership(shards) {
  const allArticles = new Set()
  const articleSettingByPath = new Map()
  const articlePathsByKey = new Map()
  const ownersByKey = new Map()
  for (const shard of shards) {
    for (const a of shard.articles || []) {
      allArticles.add(a)
      articleSettingByPath.set(a, shard.settingKey)
      const k = toOwnershipKey(a, shard.settingKey)
      const p = articlePathsByKey.get(k) || []
      p.push(a)
      articlePathsByKey.set(k, p)
    }
    for (const c of shard.ownershipClaims || []) {
      const k = toOwnershipKey(c.ownedArticle, shard.settingKey)
      const o = ownersByKey.get(k) || []
      o.push(c.indexFile)
      ownersByKey.set(k, o)
    }
  }
  return { allArticles, articleSettingByPath, articlePathsByKey, ownersByKey }
}

// NEW logic: both sides reduced to toOwnershipKey, distinct owners only,
// basename collisions surfaced. Mirrors the fixed source.
function aggregateNew(shards) {
  const { allArticles, articleSettingByPath, articlePathsByKey, ownersByKey } = collectOwnership(shards)
  const collisions = []
  for (const p of articlePathsByKey.values()) {
    const d = Array.from(new Set(p))
    if (d.length > 1) collisions.push(d)
  }
  const findings = []
  for (const a of allArticles) {
    const o = Array.from(new Set(ownersByKey.get(toOwnershipKey(a, articleSettingByPath.get(a))) || []))
    if (o.length !== 1) findings.push({ file: a, ownerCount: o.length })
  }
  return { findings, collisions }
}

// ENFORCEMENT-OFF regression guard for the singleOwnership whole-KB check.
// This is a separate defect from the ownership-key bug above: the central
// singleOwnership aggregation in validation-sweep.mjs never read the rule's
// `enforcement`, so a DM who set their singleOwnership rule to "off" still
// received sweep findings for it. Shard workers are told to skip "off"
// rules, but are also told NOT to evaluate singleOwnership themselves (it
// needs the whole KB, so it is computed centrally, same as aggregateNew
// above); the shard-level skip-off instruction never reaches this check,
// which is exactly why the bug shipped.
//
// aggregateSingleOwnershipPreFix reproduces that gap: the same ownership
// pass as aggregateNew, with no enforcement check at all.
function aggregateSingleOwnershipPreFix(shards) {
  const { findings } = aggregateNew(shards)
  return { findings }
}

// aggregateSingleOwnershipFixed mirrors the shipped guard. Enforcement is
// resolved PER ARTICLE, inside the loop, from that article's own setting's
// config: the rule id is that setting's singleOwnershipRuleId (rule ids are
// free-form, so one setting may call it structuralSingleOwnership and another
// singleOwnership), and "off" is read off that setting's own rules object.
// There is deliberately no hoisted boolean and no all-or-nothing early return:
// a project can declare several settings and each owns its enforcement choice
// independently, so setting A having the rule off must not suppress setting
// B's findings. `settingConfigs` here is the same Map validation-sweep.mjs
// builds, keyed by setting key, values carrying at least {rules,
// singleOwnershipRuleId}. Absent is not off: only the literal string "off"
// suppresses, which is why the guard tests the rule entry's own value rather
// than its presence.
function aggregateSingleOwnershipFixed(shards, settingConfigs) {
  const { allArticles, articleSettingByPath, ownersByKey } = collectOwnership(shards)
  const findings = []
  for (const article of allArticles) {
    const settingKey = articleSettingByPath.get(article)
    const cfg = settingConfigs.get(settingKey)
    const ruleId = (cfg && cfg.singleOwnershipRuleId) || 'singleOwnership'
    const off = Boolean(cfg && cfg.rules[ruleId] && cfg.rules[ruleId].enforcement === 'off')
    if (off) continue
    const owners = Array.from(new Set(ownersByKey.get(toOwnershipKey(article, settingKey)) || []))
    if (owners.length === 1) continue
    findings.push({ file: article, ownerCount: owners.length, ruleId })
  }
  return { findings }
}

// Mirrors normalizeRel in validation-sweep.mjs. The source defines it once
// (near the kbRoot-vs-file prefix matching) and reuses it for the tag-registry
// conflict guard's grouping key below; this mirror is used the same way.
const normalizeRel = (p) =>
  String(p == null ? '' : p)
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')

// Mirrors the tag-registry conflict block in the phase('Aggregate') section of
// validation-sweep.mjs (the block starting "Two settings can still land on the
// same tagRegistryPath"). Takes the same shape run() builds for
// proposedTagRegistries: an array of { setting, tagRegistryPath, registry }.
// Groups by normalizeRel(tagRegistryPath), not the raw string, so two
// spellings of the same file on disk (".professor-orb/tag-registry.json" vs
// "./.professor-orb/tag-registry.json") are recognized as one conflict; the
// reported tagRegistryPath is the first group member's literal, unnormalized
// value, exactly as the DM would recognize it and exactly as conventions.json
// records it, not the normalized string used only for comparison. Mutates
// entry.conflict = true on every member of a group of more than one, the same
// mutation the source performs on its own proposedTagRegistries array.
// Logging is omitted; it carries no logic to verify.
function detectTagRegistryConflicts(proposedTagRegistries) {
  const tagRegistryConflicts = []
  const needsJudgmentItems = []
  const registriesByPath = new Map()
  for (const entry of proposedTagRegistries) {
    const groupKey = normalizeRel(entry.tagRegistryPath)
    const group = registriesByPath.get(groupKey) || []
    group.push(entry)
    registriesByPath.set(groupKey, group)
  }
  for (const group of registriesByPath.values()) {
    if (group.length <= 1) continue
    const registryPath = group[0].tagRegistryPath
    const names = group.map((e) => e.setting || '(unnamed)')
    const distinctContents = new Set(group.map((e) => JSON.stringify(e.registry)))
    for (const entry of group) entry.conflict = true
    tagRegistryConflicts.push({ tagRegistryPath: registryPath, settings: names, contentsDiffer: distinctContents.size > 1 })
    // This item flags a conventions.json misconfiguration, not a rule
    // violation found in a KB article, so it does not carry a real ruleId or
    // an article path the way every other needsJudgment item does. kind marks
    // that explicitly; ruleId is null rather than a fake rule-id string.
    needsJudgmentItems.push({
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
  return { tagRegistryConflicts, needsJudgmentItems }
}

// Synthetic shards in the real shapes: articles are full relative paths,
// ownershipClaims carry the bare wikilink targets an index lists, and
// settingKey is the declared index of the single setting the shard covers.
const IDX = 'kb/archfey/Archfey-INDEX.md'
const shards = [{
  settingKey: '0',
  articles: [
    'kb/archfey/Baba-Yaga.md',
    'kb/archfey/Titania.md',
    'kb/archfey/Orphan.md',
    'kb/a/Dup.md',
    'kb/b/Dup.md',
    'kb/places/Shared.md',
  ],
  ownershipClaims: [
    { indexFile: IDX, ownedArticle: 'Baba-Yaga' },
    { indexFile: IDX, ownedArticle: 'Titania' },
    { indexFile: IDX, ownedArticle: 'Baba-Yaga' },                       // duplicate listing -> still 1 owner
    { indexFile: 'kb/a/A-INDEX.md', ownedArticle: 'Dup' },
    { indexFile: 'kb/places/Places-INDEX.md', ownedArticle: 'Shared' },
    { indexFile: 'kb/regions/Regions-INDEX.md', ownedArticle: 'Shared' }, // 2nd distinct owner
  ],
}]

let ok = true
const assert = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); ok = ok && cond }

// The normalizer collapses every form either side can emit to one key.
const forms = [
  'kb/archfey/Baba-Yaga.md',
  'Baba-Yaga',
  'Baba-Yaga\\|Baba Yaga',
  '[[Baba-Yaga]]',
  'archfey/Baba-Yaga',
  'Baba-Yaga.md',
  'Baba-Yaga#History',
  'Baba-Yaga\\',
]
assert('all forms normalize to baba-yaga', forms.every(f => toOwnershipKey(f) === 'baba-yaga'))

// OLD logic reproduces the bug: an owned article is still flagged 0-owner, and
// every article in the KB is falsely flagged.
const old = aggregateOld(shards)
const oldByFile = Object.fromEntries(old.findings.map(f => [f.file, f.ownerCount]))
assert('OLD: owned Baba-Yaga wrongly flagged as orphan', oldByFile['kb/archfey/Baba-Yaga.md'] === 0)
assert('OLD: every article falsely flagged', old.findings.length === shards[0].articles.length)

// NEW logic reaches the correct verdicts.
const neu = aggregateNew(shards)
const byFile = Object.fromEntries(neu.findings.map(f => [f.file, f.ownerCount]))
assert('NEW: Baba-Yaga owned, not flagged', byFile['kb/archfey/Baba-Yaga.md'] === undefined)
assert('NEW: Titania owned, not flagged', byFile['kb/archfey/Titania.md'] === undefined)
assert('NEW: duplicate listing counts as one owner', byFile['kb/archfey/Baba-Yaga.md'] === undefined)
assert('NEW: genuine orphan flagged 0', byFile['kb/archfey/Orphan.md'] === 0)
assert('NEW: multi-owner flagged 2', byFile['kb/places/Shared.md'] === 2)
assert('NEW: exactly two findings (orphan + multi-owner)', neu.findings.length === 2)
assert('NEW: basename collision detected', neu.collisions.length === 1)

// CROSS-SETTING regression: two settings are each entitled to their own
// Tavern.md under the per-setting vault boundary. Before this fix the key
// was a bare basename in one global namespace, so both indexes' ownership
// claims would land on the same ownersByKey entry and BOTH articles would
// misreport as owned by 2 indexes, a multi-owner violation that isn't one.
// The prefix is the declared index ('0', '1'), not the display name, so two
// settings that happen to share a name stay separated too.
const crossSettingShards = [
  {
    settingKey: '0',
    articles: ['world-of-rolara-kb/inns/Tavern.md'],
    ownershipClaims: [{ indexFile: 'world-of-rolara-kb/inns/Inns-INDEX.md', ownedArticle: 'Tavern' }],
  },
  {
    settingKey: '1',
    articles: ['neverwinter-kb/inns/Tavern.md'],
    ownershipClaims: [{ indexFile: 'neverwinter-kb/inns/Inns-INDEX.md', ownedArticle: 'Tavern' }],
  },
]
assert(
  'CROSS-SETTING: the two settings\' Tavern.md keys are distinct',
  toOwnershipKey('Tavern', '0') !== toOwnershipKey('Tavern', '1'),
)
const crossSetting = aggregateNew(crossSettingShards)
assert('CROSS-SETTING: zero findings, each Tavern.md has exactly one owner in its own setting', crossSetting.findings.length === 0)
assert('CROSS-SETTING: no basename collision either, the keys never merge', crossSetting.collisions.length === 0)

// Enforcement-off regression: shards contain a genuine single-ownership
// violation (Shared.md, owned by two distinct indexes), but the DM has set
// the singleOwnership rule to "off". An "off" rule must produce no finding
// of any kind, so it can never reach needsJudgment.
const offConfigs = new Map([
  ['0', { rules: { structuralSingleOwnership: { check: 'singleOwnership', enforcement: 'off' } }, singleOwnershipRuleId: 'structuralSingleOwnership' }],
])
// Rule id absent from the rules object entirely: absent is not off.
const missingConfigs = new Map([
  ['0', { rules: {}, singleOwnershipRuleId: 'structuralSingleOwnership' }],
])

const preFixOff = aggregateSingleOwnershipPreFix(shards)
assert('PRE-FIX (bug): central aggregation ignores enforcement, findings emitted anyway', preFixOff.findings.length > 0)

const fixedOff = aggregateSingleOwnershipFixed(shards, offConfigs)
assert('FIXED: off rule produces no finding', fixedOff.findings.length === 0)

const fixedAbsent = aggregateSingleOwnershipFixed(shards, missingConfigs)
assert(
  'FIXED: absent rule entry is NOT treated as off, findings still produced',
  fixedAbsent.findings.length === preFixOff.findings.length,
)

// MULTI-SETTING enforcement: setting A has singleOwnership off, setting B has
// it on, and BOTH hold real violations (an orphan and a two-owner article
// each). A's findings must be absent and B's must be present. This is the case
// an all-or-nothing guard cannot express: a single hoisted boolean with an
// early return either suppresses both settings or neither, which is why this
// file modelled the source incorrectly before. It also pins the per-setting
// rule id: each finding must carry its own setting's rule name, not a shared
// one.
const multiSettingShards = [
  {
    settingKey: '0',
    articles: ['a-kb/Orphan-A.md', 'a-kb/Shared-A.md'],
    ownershipClaims: [
      { indexFile: 'a-kb/One-INDEX.md', ownedArticle: 'Shared-A' },
      { indexFile: 'a-kb/Two-INDEX.md', ownedArticle: 'Shared-A' },
    ],
  },
  {
    settingKey: '1',
    articles: ['b-kb/Orphan-B.md', 'b-kb/Shared-B.md'],
    ownershipClaims: [
      { indexFile: 'b-kb/One-INDEX.md', ownedArticle: 'Shared-B' },
      { indexFile: 'b-kb/Two-INDEX.md', ownedArticle: 'Shared-B' },
    ],
  },
]
const multiSettingConfigs = new Map([
  ['0', {
    setting: 'Setting A',
    rules: { structuralSingleOwnership: { check: 'singleOwnership', enforcement: 'off' } },
    singleOwnershipRuleId: 'structuralSingleOwnership',
  }],
  ['1', {
    setting: 'Setting B',
    rules: { singleOwnership: { check: 'singleOwnership', enforcement: 'warn' } },
    singleOwnershipRuleId: 'singleOwnership',
  }],
])

// Both settings really do hold violations: with enforcement ignored, all four
// articles are flagged. Without this the "A absent" assertion below could pass
// for the wrong reason.
const multiUnguarded = aggregateSingleOwnershipPreFix(multiSettingShards)
assert('MULTI-SETTING: both settings genuinely hold violations (4 with enforcement ignored)', multiUnguarded.findings.length === 4)

const multi = aggregateSingleOwnershipFixed(multiSettingShards, multiSettingConfigs)
const multiFiles = multi.findings.map(f => f.file)
assert('MULTI-SETTING: setting A has the rule off, so none of its articles are flagged', !multiFiles.some(f => f.startsWith('a-kb/')))
assert('MULTI-SETTING: setting B has the rule on, its orphan is flagged', multiFiles.includes('b-kb/Orphan-B.md'))
assert('MULTI-SETTING: setting B has the rule on, its multi-owner article is flagged', multiFiles.includes('b-kb/Shared-B.md'))
assert('MULTI-SETTING: exactly setting B\'s two findings survive', multi.findings.length === 2)
assert('MULTI-SETTING: findings carry setting B\'s own rule id, not setting A\'s', multi.findings.every(f => f.ruleId === 'singleOwnership'))

// The mirror image, to prove the guard is per setting and not merely
// order-dependent: flip which setting is off and the surviving findings flip
// with it.
const flippedConfigs = new Map([
  ['0', {
    setting: 'Setting A',
    rules: { structuralSingleOwnership: { check: 'singleOwnership', enforcement: 'warn' } },
    singleOwnershipRuleId: 'structuralSingleOwnership',
  }],
  ['1', {
    setting: 'Setting B',
    rules: { singleOwnership: { check: 'singleOwnership', enforcement: 'off' } },
    singleOwnershipRuleId: 'singleOwnership',
  }],
])
const flipped = aggregateSingleOwnershipFixed(multiSettingShards, flippedConfigs)
const flippedFiles = flipped.findings.map(f => f.file)
assert('MULTI-SETTING (flipped): setting B is now off, none of its articles are flagged', !flippedFiles.some(f => f.startsWith('b-kb/')))
assert('MULTI-SETTING (flipped): setting A is now on, both of its articles are flagged', flipped.findings.length === 2 && flippedFiles.every(f => f.startsWith('a-kb/')))
assert('MULTI-SETTING (flipped): findings carry setting A\'s own rule id', flipped.findings.every(f => f.ruleId === 'structuralSingleOwnership'))

// TAG REGISTRY CONFLICT regression: two settings resolving to the same tag
// registry path must be flagged, marked conflict:true on both entries, and
// surfaced as a needsJudgment item shaped so a caller cannot mistake it for a
// rule violation on an article.

// Baseline: distinct paths, no conflict, no mutation.
const noConflictRegistries = [
  { setting: 'World of Rolara', tagRegistryPath: 'world-of-rolara-kb/tag-registry.json', registry: { faction: 3 } },
  { setting: 'Neverwinter Nights', tagRegistryPath: 'neverwinter-kb/tag-registry.json', registry: { faction: 2 } },
]
const noConflict = detectTagRegistryConflicts(noConflictRegistries)
assert('NO CONFLICT: distinct paths produce zero conflicts', noConflict.tagRegistryConflicts.length === 0)
assert('NO CONFLICT: distinct paths produce zero needsJudgment items', noConflict.needsJudgmentItems.length === 0)
assert('NO CONFLICT: entries are not mutated', noConflictRegistries.every((e) => e.conflict === undefined))

// Two settings that wrote the identical string in conventions.json.
const sameRawPath = [
  { setting: 'World of Rolara', tagRegistryPath: '.professor-orb/tag-registry.json', registry: { faction: 3 } },
  { setting: 'Neverwinter Nights', tagRegistryPath: '.professor-orb/tag-registry.json', registry: { faction: 5 } },
]
const sameRaw = detectTagRegistryConflicts(sameRawPath)
assert('SAME PATH: one conflict recorded', sameRaw.tagRegistryConflicts.length === 1)
assert('SAME PATH: both entries mutated conflict true', sameRawPath.every((e) => e.conflict === true))
assert('SAME PATH: contentsDiffer true, registries differ', sameRaw.tagRegistryConflicts[0].contentsDiffer === true)
assert(
  'SAME PATH: needsJudgment item carries kind tagRegistryConflict and a null ruleId, not a fake rule id',
  sameRaw.needsJudgmentItems[0].kind === 'tagRegistryConflict' && sameRaw.needsJudgmentItems[0].ruleId === null,
)
assert(
  'SAME PATH: needsJudgment item file is the registry path',
  sameRaw.needsJudgmentItems[0].file === '.professor-orb/tag-registry.json',
)

// PATH-NORMALIZATION regression (the fix under test): two settings resolve to
// the same file on disk but spelled it differently in conventions.json.
// Grouping on the raw string would put these in separate groups of one and
// the conflict would never fire, silently letting the fix phase overwrite
// whichever registry was written second.
const differentSpellings = [
  { setting: 'World of Rolara', tagRegistryPath: './.professor-orb/tag-registry.json', registry: { faction: 3 } },
  { setting: 'Neverwinter Nights', tagRegistryPath: '.professor-orb/tag-registry.json', registry: { faction: 3 } },
]
const spelled = detectTagRegistryConflicts(differentSpellings)
assert('SPELLING: differing spellings of the same file are grouped as one conflict', spelled.tagRegistryConflicts.length === 1)
assert('SPELLING: both entries mutated conflict true', differentSpellings.every((e) => e.conflict === true))
assert(
  'SPELLING: reported path is the literal first entry, not the normalized form',
  spelled.needsJudgmentItems[0].file === './.professor-orb/tag-registry.json',
)
assert('SPELLING: identical registries so contentsDiffer is false', spelled.tagRegistryConflicts[0].contentsDiffer === false)

// A third, genuinely distinct setting must be untouched by the other two's
// conflict: the guard groups per normalized path, not all-or-nothing.
const mixedRegistries = [
  { setting: 'World of Rolara', tagRegistryPath: './.professor-orb/tag-registry.json', registry: { faction: 3 } },
  { setting: 'Neverwinter Nights', tagRegistryPath: '.professor-orb/tag-registry.json', registry: { faction: 4 } },
  { setting: 'Baldurs Gate', tagRegistryPath: 'baldurs-gate-kb/tag-registry.json', registry: { faction: 1 } },
]
const mixed = detectTagRegistryConflicts(mixedRegistries)
assert('MIXED: exactly one conflict group among three settings', mixed.tagRegistryConflicts.length === 1)
assert('MIXED: the third, genuinely distinct setting is not mutated', mixedRegistries[2].conflict === undefined)
assert(
  'MIXED: the conflicting pair is mutated',
  mixedRegistries[0].conflict === true && mixedRegistries[1].conflict === true,
)

// DETERMINISTIC ENUMERATION AND CLAIMS EXTRACTION regression guard, added
// alongside the 2026-08-02 fix. Two mirrors from validation-sweep.mjs:
// isIndexFile, parseClaimLine, claimsFromLines, and sliceRanges, byte-aligned
// with the corresponding definitions in the source (the block right above
// `async function run()`). Keep them that way, same as every other mirror in
// this file.
const isIndexFile = (file, suffixLower) => {
  if (!suffixLower) return false
  const normalized = String(file == null ? '' : file).replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const lastDot = base.lastIndexOf('.')
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base
  return stem.toLowerCase().endsWith(suffixLower)
}

const parseClaimLine = (raw) => {
  const line = String(raw == null ? '' : raw)
  const linkAt = line.indexOf('[[')
  if (linkAt === -1) return null
  const head = /^(.*):(\d+):(\d+):$/.exec(line.slice(0, linkAt))
  if (!head) return null
  return { indexFile: head[1], line: Number(head[2]), offset: Number(head[3]), target: line.slice(linkAt) }
}

const claimsFromLines = (lines) => {
  const firstPerLine = new Map()
  let unparseable = 0
  for (const raw of Array.isArray(lines) ? lines : []) {
    const parsed = parseClaimLine(raw)
    if (!parsed) {
      unparseable++
      continue
    }
    const byLine = firstPerLine.get(parsed.indexFile) || new Map()
    const held = byLine.get(parsed.line)
    if (!held || parsed.offset < held.offset) byLine.set(parsed.line, parsed)
    firstPerLine.set(parsed.indexFile, byLine)
  }
  const claims = []
  for (const byLine of firstPerLine.values()) {
    for (const p of byLine.values()) claims.push({ indexFile: p.indexFile, ownedArticle: p.target })
  }
  return { claims, unparseable }
}

const sliceRanges = (total, size) => {
  const ranges = []
  for (let from = 1; from <= total; from += size) ranges.push({ from, to: Math.min(from + size - 1, total) })
  return ranges
}

// isIndexFile: case-insensitive suffix match on the stem, empty suffix always false.
assert('isIndexFile: matches the configured suffix case-insensitively', isIndexFile('kb/archfey/Archfey-index.md', '-index'))
assert('isIndexFile: an ordinary article does not match', !isIndexFile('kb/archfey/Baba-Yaga.md', '-index'))
assert('isIndexFile: an empty suffix (no indexParity rule declared) never matches', !isIndexFile('kb/archfey/Archfey-INDEX.md', ''))
assert('isIndexFile: a dotless filename does not crash and does not match', !isIndexFile('kb/archfey/README', '-index'))

// sliceRanges: 1-based, inclusive, the exact form `sed -n 'FROM,TOp'` takes.
const ranges25 = sliceRanges(25, 12)
assert(
  'sliceRanges: 25 items at size 12 produce three ranges covering 1-25 with no gap or overlap',
  JSON.stringify(ranges25) === JSON.stringify([{ from: 1, to: 12 }, { from: 13, to: 24 }, { from: 25, to: 25 }]),
)
assert('sliceRanges: zero items produce zero ranges', sliceRanges(0, 12).length === 0)

// THE REGRESSION CASE NAMED IN THE BUG REPORT: real `grep -bnoHE` output
// captured from the project's actual settings/rolara/characters/archfey/
// Archfey-INDEX.md (16 entries, escaped-pipe table rows, one row -
// Bear Prince Urso's - carrying a second, in-prose wikilink to Caliban that
// must NOT be counted as a 17th claim).
const archfeyGrepLines = [
  'kb/archfey/Archfey-INDEX.md:15:459:[[Baba-Yaga\\|Baba Yaga]]',
  'kb/archfey/Archfey-INDEX.md:16:593:[[Bear-Prince-Urso\\|Bear Prince Urso]]',
  'kb/archfey/Archfey-INDEX.md:16:743:[[Caliban\\|Caliban]]',
  'kb/archfey/Archfey-INDEX.md:17:836:[[Daegolor\\|Daegolor]]',
  'kb/archfey/Archfey-INDEX.md:18:969:[[Faerieth\\|Faerieth]]',
  'kb/archfey/Archfey-INDEX.md:19:1052:[[Ilactariel\\|Ilactariel]]',
  'kb/archfey/Archfey-INDEX.md:20:1083:[[Jack-Frost\\|Jack Frost]]',
  'kb/archfey/Archfey-INDEX.md:21:1114:[[Jingling\\|Jingling]]',
  'kb/archfey/Archfey-INDEX.md:22:1141:[[Múnla\\|Múnla]]',
  'kb/archfey/Archfey-INDEX.md:23:1164:[[Nalea\\|Nalea]]',
  'kb/archfey/Archfey-INDEX.md:24:1185:[[Nerizorwyn\\|Nerizorwyn]]',
  'kb/archfey/Archfey-INDEX.md:25:1216:[[Oberon\\|Oberon]]',
  'kb/archfey/Archfey-INDEX.md:26:1239:[[Queen-of-Air-and-Darkness\\|Queen of Air and Darkness]]',
  'kb/archfey/Archfey-INDEX.md:27:1300:[[Rionnon\\|Rionnon]]',
  'kb/archfey/Archfey-INDEX.md:28:1325:[[Ru-Ling\\|Ru Ling]]',
  'kb/archfey/Archfey-INDEX.md:29:1350:[[Titania\\|Titania]]',
  'kb/archfey/Archfey-INDEX.md:30:1375:[[Verrin\\|Verrin]]',
]
const archfeyParsed = claimsFromLines(archfeyGrepLines)
assert('ARCHFEY: all 17 grep lines parse cleanly, none unparseable', archfeyParsed.unparseable === 0)
assert('ARCHFEY: exactly 16 claims recovered, not 8 (the 2026-08-02 under-transcription) and not 17', archfeyParsed.claims.length === 16)
const archfeyOwnersByKey = new Map()
for (const c of archfeyParsed.claims) {
  const key = toOwnershipKey(c.ownedArticle, 'rolara')
  const owners = archfeyOwnersByKey.get(key) || []
  owners.push(c.indexFile)
  archfeyOwnersByKey.set(key, owners)
}
for (const name of [
  'Baba-Yaga', 'Bear-Prince-Urso', 'Daegolor', 'Faerieth', 'Ilactariel', 'Jack-Frost', 'Jingling', 'Múnla',
  'Nalea', 'Nerizorwyn', 'Oberon', 'Queen-of-Air-and-Darkness', 'Rionnon', 'Ru-Ling', 'Titania', 'Verrin',
]) {
  const owners = archfeyOwnersByKey.get(toOwnershipKey(name, 'rolara')) || []
  assert('ARCHFEY: ' + name + ' is owned by exactly the Archfey index (this failed as a false orphan before the fix)', owners.length === 1)
}
assert(
  'ARCHFEY: Caliban (in-prose mention on the Bear Prince Urso row) is NOT claimed by the index',
  !archfeyOwnersByKey.has(toOwnershipKey('Caliban', 'rolara')),
)

// An unparseable line (does not end in :digits:digits: before its first "[[")
// is counted, not silently dropped, and does not crash the parse of the lines
// around it.
const withGarbageLine = archfeyGrepLines
  .slice(0, 3)
  .concat(['this line did not come from grep at all'])
const garbageParsed = claimsFromLines(withGarbageLine)
assert('UNPARSEABLE: one bad line is counted', garbageParsed.unparseable === 1)
assert('UNPARSEABLE: the well-formed lines around it still parse', garbageParsed.claims.length === 2)

// SUPPRESSION regression: when a setting's deterministic claims extraction
// fails verification (mirrors the "unverifiedClaimSettings" gate in the
// source's singleOwnership loop), that setting's findings must not appear at
// all, not appear as false 0-owner orphans, because the correct read of a
// failed extraction is "this run could not tell," not "no index owns this."
function aggregateSingleOwnershipWithUnverified(shards, settingConfigs, unverifiedSettings) {
  const { allArticles, articleSettingByPath, ownersByKey } = collectOwnership(shards)
  const findings = []
  for (const article of allArticles) {
    const settingKey = articleSettingByPath.get(article)
    if (unverifiedSettings.has(settingKey)) continue
    const cfg = settingConfigs.get(settingKey)
    const ruleId = (cfg && cfg.singleOwnershipRuleId) || 'singleOwnership'
    const off = Boolean(cfg && cfg.rules[ruleId] && cfg.rules[ruleId].enforcement === 'off')
    if (off) continue
    const owners = Array.from(new Set(ownersByKey.get(toOwnershipKey(article, settingKey)) || []))
    if (owners.length === 1) continue
    findings.push({ file: article, ownerCount: owners.length, ruleId })
  }
  return { findings }
}

const suppressionShards = [{
  settingKey: '0',
  articles: ['kb/archfey/Baba-Yaga.md', 'kb/archfey/Orphan.md'],
  ownershipClaims: [], // as if the checkers correctly returned nothing (centralOwnership true)
}]
const suppressionConfigs = new Map([
  ['0', { rules: { structuralSingleOwnership: { enforcement: 'warn' } }, singleOwnershipRuleId: 'structuralSingleOwnership' }],
])
const withoutSuppression = aggregateSingleOwnershipWithUnverified(suppressionShards, suppressionConfigs, new Set())
assert(
  'SUPPRESSION: with no unverified settings, both articles report as unowned (baseline)',
  withoutSuppression.findings.length === 2,
)
const withSuppression = aggregateSingleOwnershipWithUnverified(suppressionShards, suppressionConfigs, new Set(['0']))
assert(
  'SUPPRESSION: a setting whose claims extraction failed verification reports ZERO singleOwnership findings, not false orphans',
  withSuppression.findings.length === 0,
)

console.log(ok ? '\nAll checks passed.' : '\nSome checks FAILED.')
process.exit(ok ? 0 : 1)
