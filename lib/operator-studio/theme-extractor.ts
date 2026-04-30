/**
 * Theme extractor — pull the topic shape out of a session's messages
 * as a weighted keyword set.
 *
 * Not an LLM — we tokenize, filter stopwords, collapse inflections
 * (-ing, -ed, -s), and weight by message-frequency (how many distinct
 * messages mention the term), not raw term-frequency. That way a
 * single long code dump that repeats "const" 50 times doesn't swamp
 * a term that genuinely recurs across the session's thinking.
 *
 * Output is a ranked list of {term, weight, messageHits}. The UI
 * renders a small tag cloud where size/opacity tracks weight.
 */

export interface ThemeTerm {
  term: string
  weight: number
  /** Distinct messages that mention this term. */
  messageHits: number
}

// Generic English stopwords + conversational noise ("ok", "yeah") +
// common code/markdown tokens ("const", "return") + agentic-chat
// connective vocabulary that recurs in ANY conversation regardless
// of subject ("working", "new", "fixing", "next", "checking", "files",
// "add"). Without aggressive dev-chat filtering the constellation
// just shows what an agent's prose typically contains, not what the
// CONVERSATION is actually about.
const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "about",
  "actually",
  "after",
  "again",
  "against",
  "all",
  "also",
  "am",
  "an",
  "and",
  "any",
  "are",
  "arent",
  "as",
  "at",
  "back",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "cant",
  "case",
  "code",
  "const",
  "could",
  "couldnt",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "dont",
  "down",
  "during",
  "each",
  "else",
  "etc",
  "even",
  "every",
  "for",
  "from",
  "function",
  "get",
  "give",
  "go",
  "going",
  "got",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "im",
  "in",
  "into",
  "is",
  "isnt",
  "it",
  "its",
  "just",
  "know",
  "let",
  "like",
  "lot",
  "make",
  "many",
  "me",
  "might",
  "more",
  "most",
  "my",
  "need",
  "no",
  "not",
  "now",
  "null",
  "of",
  "off",
  "ok",
  "okay",
  "on",
  "once",
  "one",
  "only",
  "or",
  "other",
  "our",
  "out",
  "over",
  "own",
  "really",
  "return",
  "same",
  "say",
  "see",
  "she",
  "should",
  "since",
  "so",
  "some",
  "something",
  "still",
  "such",
  "sure",
  "take",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "thing",
  "things",
  "think",
  "this",
  "those",
  "through",
  "to",
  "too",
  "true",
  "type",
  "under",
  "until",
  "up",
  "use",
  "used",
  "very",
  "want",
  "was",
  "way",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "yeah",
  "yep",
  "yes",
  "you",
  "your",
  "yours",

  // ── Dev-chat / agentic noise — verbs and nouns that show up in
  //    every Claude/Codex transcript regardless of subject. Filtering
  //    these aggressively is what separates "themes about your work"
  //    from "themes about how the agent talks."
  "actually",
  "add",
  "added",
  "adding",
  "approach",
  "back",
  "build",
  "building",
  "case",
  "cases",
  "check",
  "checking",
  "claude",
  "clean",
  "cleaning",
  "codex",
  "commit",
  "commits",
  "committing",
  "create",
  "created",
  "creating",
  "default",
  "edit",
  "edits",
  "edited",
  "editing",
  "fail",
  "failed",
  "fails",
  "fine",
  "first",
  "fix",
  "fixed",
  "fixing",
  "go",
  "going",
  "great",
  "happen",
  "happening",
  "happens",
  "ill",
  "implement",
  "implemented",
  "implementing",
  "issue",
  "issues",
  "last",
  "later",
  "less",
  "live",
  "look",
  "looking",
  "looks",
  "made",
  "main",
  "mean",
  "means",
  "moment",
  "move",
  "moving",
  "name",
  "names",
  "needed",
  "new",
  "next",
  "nice",
  "non",
  "nothing",
  "ok",
  "old",
  "open",
  "opening",
  "page",
  "pages",
  "part",
  "parts",
  "pass",
  "passed",
  "place",
  "point",
  "points",
  "pretty",
  "probably",
  "put",
  "quick",
  "quickly",
  "ran",
  "read",
  "reading",
  "ready",
  "reason",
  "render",
  "renders",
  "rendering",
  "rest",
  "right",
  "rights",
  "run",
  "running",
  "save",
  "saved",
  "ship",
  "shipping",
  "show",
  "shown",
  "showing",
  "side",
  "sides",
  "simple",
  "simpler",
  "simplest",
  "small",
  "smaller",
  "source",
  "sources",
  "split",
  "start",
  "started",
  "starts",
  "starting",
  "step",
  "steps",
  "stop",
  "stopped",
  "stuff",
  "test",
  "tested",
  "tests",
  "testing",
  "told",
  "top",
  "total",
  "track",
  "try",
  "tries",
  "trying",
  "turn",
  "turns",
  "two",
  "update",
  "updates",
  "updated",
  "updating",
  "user",
  "users",
  "version",
  "versions",
  "view",
  "views",
  "wait",
  "wanted",
  "wants",
  "wasnt",
  "weeks",
  "wins",
  "won",
  "work",
  "worked",
  "working",
  "works",
  "write",
  "writes",
  "wrote",

  // ── Tool/code lexicon — avoid tag-cloud being a glossary of types
  //    and operators ("file", "function", "class", "string", "number")
  //    when the user wants subject-matter themes.
  "api",
  "app",
  "args",
  "array",
  "arrays",
  "boolean",
  "branch",
  "branches",
  "char",
  "chars",
  "class",
  "classes",
  "click",
  "clicked",
  "clicking",
  "client",
  "command",
  "config",
  "consts",
  "data",
  "doc",
  "docs",
  "endpoint",
  "endpoints",
  "env",
  "error",
  "errors",
  "field",
  "fields",
  "file",
  "files",
  "flag",
  "flags",
  "func",
  "import",
  "imports",
  "input",
  "inputs",
  "interface",
  "interfaces",
  "items",
  "key",
  "keys",
  "lib",
  "line",
  "lines",
  "list",
  "lists",
  "log",
  "logs",
  "merge",
  "method",
  "methods",
  "module",
  "modules",
  "obj",
  "object",
  "objects",
  "option",
  "options",
  "output",
  "outputs",
  "param",
  "params",
  "patch",
  "path",
  "paths",
  "ping",
  "post",
  "prop",
  "props",
  "push",
  "queries",
  "query",
  "react",
  "reload",
  "request",
  "requests",
  "response",
  "responses",
  "result",
  "results",
  "row",
  "rows",
  "schema",
  "script",
  "server",
  "servers",
  "set",
  "sets",
  "setting",
  "settings",
  "size",
  "stack",
  "state",
  "string",
  "strings",
  "table",
  "tables",
  "test",
  "tests",
  "text",
  "tool",
  "tools",
  "ui",
  "url",
  "urls",
  "value",
  "values",
  "var",
  "vars",
  "version",
  "void",
])

/**
 * Stem a word in the cheapest way that still collapses common English
 * inflections: plural s, past -ed, progressive -ing. Not linguistically
 * correct (e.g. "bring" → "br"), but good enough to merge "plan/plans/
 * planning" into one bucket.
 */
function stem(word: string): string {
  if (word.length <= 4) return word
  // Trim a trailing doubled consonant left over from -ing/-ed stripping
  // (planning → plann → plan, running → runn → run).
  function trimDoubledTail(s: string): string {
    if (s.length < 3) return s
    const a = s[s.length - 1]
    const b = s[s.length - 2]
    if (a === b && /[bcdfghjklmnpqrstvwxz]/.test(a)) return s.slice(0, -1)
    return s
  }
  if (word.endsWith("ing") && word.length > 5) {
    return trimDoubledTail(word.slice(0, -3))
  }
  if (word.endsWith("ed") && word.length > 4) {
    return trimDoubledTail(word.slice(0, -2))
  }
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y"
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1)
  }
  return word
}

function tokenize(text: string): string[] {
  // Lowercase, strip URLs, strip code fences' contents, keep
  // word-like runs of letters and hyphens.
  const withoutCode = text.replace(/```[\s\S]*?```/g, " ")
  const withoutInlineCode = withoutCode.replace(/`[^`]*`/g, " ")
  const withoutUrls = withoutInlineCode.replace(/https?:\/\/\S+/g, " ")
  return withoutUrls
    .toLowerCase()
    .replace(/[^a-z\-'\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, "")) // trim leading/trailing punct
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w))
}

export interface ExtractThemesInput {
  messages: Array<{ id: string; content: string }>
  /** Terms to return. Default 20. */
  topN?: number
  /** Minimum distinct-message hits to include a term. Default 2. */
  minMessageHits?: number
}

export function extractThemes(input: ExtractThemesInput): ThemeTerm[] {
  const topN = input.topN ?? 20
  const minMessageHits = input.minMessageHits ?? 2

  // messageHits: how many distinct messages contain this stem at least
  // once. totalCount: raw token count for tiebreaking. Using a Map
  // keyed by stem, value = {hits, total, sampleForm}.
  const stats = new Map<
    string,
    { hits: number; total: number; sampleForm: string }
  >()

  for (const msg of input.messages) {
    const tokens = tokenize(msg.content)
    const stemsSeenInMsg = new Set<string>()
    for (const tok of tokens) {
      if (STOPWORDS.has(tok)) continue
      const st = stem(tok)
      if (st.length < 3) continue
      if (STOPWORDS.has(st)) continue
      const existing = stats.get(st)
      if (existing) {
        existing.total++
        if (!stemsSeenInMsg.has(st)) existing.hits++
        // Prefer the longest original form we've seen as the display
        // representative (so "planning" wins over "plan" when we
        // show the theme).
        if (tok.length > existing.sampleForm.length) existing.sampleForm = tok
      } else {
        stats.set(st, { hits: 1, total: 1, sampleForm: tok })
      }
      stemsSeenInMsg.add(st)
    }
  }

  // Weight = hits primarily; break ties with total count. Drop stems
  // that don't recur across messages — those are personal vocabulary
  // of one message, not session themes.
  const ranked: ThemeTerm[] = []
  for (const [, v] of stats.entries()) {
    if (v.hits < minMessageHits) continue
    ranked.push({
      term: v.sampleForm,
      weight: v.hits + v.total * 0.01,
      messageHits: v.hits,
    })
  }

  ranked.sort((a, b) => b.weight - a.weight)
  return ranked.slice(0, topN)
}
