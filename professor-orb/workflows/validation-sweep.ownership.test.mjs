// Regression guard for the single-ownership aggregation in validation-sweep.mjs.
//
// The workflow module cannot be imported directly: it uses top-level await and
// workflow-runtime globals (agent, parallel, phase, log, args), so importing it
// would execute run() and throw. This test therefore mirrors the aggregation
// logic. aggregateOld reproduces the historical bug (shipped through 1.5.0);
// aggregateNew mirrors the shipped fix. Keep aggregateNew and toOwnershipKey
// byte-aligned with the phase('Aggregate') section of validation-sweep.mjs: if
// you change that logic in the source, change it here too, or this guard drifts.
//
// Run: node professor-orb/workflows/validation-sweep.ownership.test.mjs

// Shared key. Must match toOwnershipKey in validation-sweep.mjs exactly.
const toOwnershipKey = (raw) => {
  let s = String(raw).trim()
  s = s.replace(/^\[\[|\]\]$/g, '')
  s = s.replace(/\\\|/g, '|')
  s = s.split('|')[0]
  s = s.split('#')[0]
  s = s.replace(/\\/g, '/').replace(/\/+$/, '')
  const base = s.slice(s.lastIndexOf('/') + 1)
  return base.replace(/\.md$/i, '').trim().toLowerCase()
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

// NEW logic: both sides reduced to toOwnershipKey, distinct owners only,
// basename collisions surfaced. Mirrors the fixed source.
function aggregateNew(shards) {
  const allArticles = new Set()
  const articlePathsByKey = new Map()
  const ownersByKey = new Map()
  for (const shard of shards) {
    for (const a of shard.articles || []) {
      allArticles.add(a)
      const k = toOwnershipKey(a)
      const p = articlePathsByKey.get(k) || []
      p.push(a)
      articlePathsByKey.set(k, p)
    }
    for (const c of shard.ownershipClaims || []) {
      const k = toOwnershipKey(c.ownedArticle)
      const o = ownersByKey.get(k) || []
      o.push(c.indexFile)
      ownersByKey.set(k, o)
    }
  }
  const collisions = []
  for (const p of articlePathsByKey.values()) {
    const d = Array.from(new Set(p))
    if (d.length > 1) collisions.push(d)
  }
  const findings = []
  for (const a of allArticles) {
    const o = Array.from(new Set(ownersByKey.get(toOwnershipKey(a)) || []))
    if (o.length !== 1) findings.push({ file: a, ownerCount: o.length })
  }
  return { findings, collisions }
}

// Synthetic shards in the real shapes: articles are full relative paths,
// ownershipClaims carry the bare wikilink targets an index lists.
const IDX = 'kb/archfey/Archfey-INDEX.md'
const shards = [{
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

console.log(ok ? '\nAll checks passed.' : '\nSome checks FAILED.')
process.exit(ok ? 0 : 1)
