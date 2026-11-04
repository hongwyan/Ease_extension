/**
 * X Feed Lens topic catalog — the ONE place to edit topics.
 *
 * Every alias, context term, exclusion, Wikipedia mapping and example lives
 * here. `tests/unit/catalog.test.ts` runs every `examples.match` and
 * `examples.noMatch` sentence through the classifier, so adding an example is
 * also adding a test. Bump CATALOG_VERSION whenever matching behaviour changes;
 * stored exposures keep the version they were classified with.
 *
 * Matching is case-insensitive and whole-word ("ai" never matches "said").
 * Terms are plain phrases; a space in a term also matches "-" or "_".
 * `*` at the end of a term is a word-prefix wildcard ("monetiz*").
 */

export const CATALOG_VERSION = "2026.11.1";

export type TopicKind = "tool" | "claim";

export interface WikipediaMapping {
  /** Exact English Wikipedia article title, underscores instead of spaces. */
  article: string;
  /** Why this article measures the same topic. */
  justification: string;
}

export interface TopicDefinition {
  id: string;
  label: string;
  kind: TopicKind;
  /** Verb phrase used in generated sentences: "12 of 80 recorded posts <phrase>". */
  phrase: string;
  /** Lower number wins when a post matches several topics. */
  priority: number;
  /** Plain-language inclusion rule shown under "Why this result?". */
  rule: string;
  /**
   * Tool topics: any strong alias matches on its own.
   * Weak aliases only match when a context term also appears.
   */
  strongAliases?: string[];
  weakAliases?: string[];
  contextTerms?: string[];
  /**
   * Claim topics: at least one term from EVERY group must appear.
   * A group may contain `pairs`: both halves must appear (e.g. a money amount
   * plus a transaction verb).
   */
  requireAll?: EvidenceGroup[];
  /** Phrases removed from the text before matching ("claude monet"). */
  exclusions: string[];
  wikipedia: WikipediaMapping | null;
  /** Shown when wikipedia is null. */
  noPublicSeriesReason?: string;
  examples: { match: string[]; noMatch: string[] };
}

export interface EvidenceGroup {
  name: string;
  terms: string[];
  /** Regex sources (case-insensitive) that also count as evidence. */
  patterns?: string[];
  /** Each pair is [groupA, groupB]; one term from each must appear. */
  pairs?: { label: string; a: string[]; aPatterns?: string[]; b: string[] }[];
}

const AI_TERMS = [
  "ai",
  "a.i.",
  "artificial intelligence",
  "genai",
  "gen ai",
  "generative ai",
  "ai generated",
  "ai powered",
  "ai tool",
  "ai tools",
  "ai agent",
  "ai agents",
  "llm",
  "llms",
  "chatgpt",
  "chat gpt",
  "gpt",
  "gpt-4",
  "gpt-4o",
  "gpt-5",
  "openai",
  "claude",
  "anthropic",
  "gemini",
  "midjourney",
  "copilot",
  "perplexity",
  "stable diffusion",
  "dall-e",
  "sora",
  "cursor ai",
];

/** People named Claude: removed before matching so they never count as Anthropic's Claude. */
const CLAUDE_PERSON_EXCLUSIONS = [
      "claude monet",
      "monet",
      "claude debussy",
      "claude van damme",
      "jean-claude",
      "jean claude",
      "claude makelele",
      "claude makélélé",
      "claude lévi-strauss",
      "claude levi-strauss",
      "claude shannon",
      "claude rains",
      "claude giroux",
      "claude julien",
    ];

const MONEY_PATTERN =
  "(?:[$€£]\\s?\\d[\\d,.]*\\s?(?:k|m|million|thousand)?\\b|\\b\\d[\\d,.]*\\s?(?:k|m)?\\s?(?:usd|dollars|euros|pounds|bucks)\\b)";

export const TOPICS: TopicDefinition[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    kind: "tool",
    phrase: "mentioned ChatGPT",
    priority: 1,
    rule: "Mentions ChatGPT by name (“ChatGPT”, “Chat GPT”, “#ChatGPT”).",
    strongAliases: ["chatgpt", "chat gpt", "chatgpt plus", "chatgpt pro", "chatgpt atlas"],
    exclusions: [],
    wikipedia: {
      article: "ChatGPT",
      justification: "The English Wikipedia article about the ChatGPT chatbot itself.",
    },
    examples: {
      match: [
        "ChatGPT just wrote my whole cover letter",
        "Asked chat gpt to plan my week",
        "Top 10 #ChatGPT prompts for founders",
      ],
      noMatch: ["GPT stands for GUID Partition Table on disks", "chat with me about gardening"],
    },
  },
  {
    id: "claude-ai",
    label: "Claude AI",
    kind: "tool",
    phrase: "mentioned Claude AI",
    priority: 2,
    rule:
      "Mentions Anthropic's Claude: “Claude AI”, “Claude Code”, “claude.ai”, a Claude model name, " +
      "or “Claude” together with an AI context word (Anthropic, AI, LLM, model, prompt, chatbot). " +
      "People named Claude (Monet, Debussy, Van Damme…) are excluded.",
    strongAliases: [
      "claude ai",
      "claude.ai",
      "claude code",
      "claude opus",
      "claude sonnet",
      "claude haiku",
      "claude fable",
      "claude 3",
      "claude 4",
      "claude 5",
      "anthropic's claude",
      "@claudeai",
      "#claudeai",
    ],
    weakAliases: ["claude"],
    contextTerms: [
      "anthropic",
      "ai",
      "llm",
      "llms",
      "model",
      "models",
      "prompt",
      "prompts",
      "prompting",
      "chatbot",
      "chatgpt",
      "gpt",
      "gemini",
      "openai",
      "coding agent",
      "agent",
      "agents",
      "artifact",
      "artifacts",
      "context window",
      "tokens",
      "api",
      "opus",
      "sonnet",
      "haiku",
      "vibe coding",
    ],
    exclusions: CLAUDE_PERSON_EXCLUSIONS,
    wikipedia: {
      article: "Claude_(AI)",
      justification:
        "The English Wikipedia article about Anthropic's Claude models. " +
        "“Claude (language model)” now redirects here; pageviews of redirects are not counted, so the target title is used.",
    },
    examples: {
      match: [
        "Claude Code refactored my entire repo overnight",
        "Switched from ChatGPT to Claude and my prompts got shorter",
        "Anthropic just shipped a new Claude model",
        "claude.ai is my new favourite writing partner",
      ],
      noMatch: [
        "Claude Monet's water lilies at the Orangerie",
        "Watching a Jean-Claude Van Damme marathon tonight",
        "My neighbour Claude fixed my bike",
        "An AI-generated poster of a Claude Monet painting",
      ],
    },
  },
  {
    id: "ai-earnings",
    label: "Earning money with AI",
    kind: "claim",
    phrase: "described earning money with AI",
    priority: 3,
    rule:
      "Requires BOTH AI evidence (AI, LLM, ChatGPT, Claude, Midjourney, AI-generated…) AND income evidence: " +
      "an income word (earn, income, revenue, profit, side hustle, passive income, MRR, paid me, make money) " +
      "or a money amount together with a sale/payment word (sold, made, charged, paid, client, customer).",
    requireAll: [
      { name: "AI evidence", terms: AI_TERMS },
      {
        name: "Income evidence",
        terms: [
          "earn",
          "earns",
          "earned",
          "earning",
          "earnings",
          "income",
          "revenue",
          "profit",
          "profits",
          "profitable",
          "payout",
          "side hustle",
          "side hustles",
          "passive income",
          "mrr",
          "arr",
          "monetiz*",
          "monetis*",
          "make money",
          "making money",
          "made money",
          "makes money",
          "paid me",
          "paying clients",
          "paying customers",
          "cash flow",
          "6 figures",
          "six figures",
          "7 figures",
          "seven figures",
        ],
        pairs: [
          {
            label: "money amount + transaction",
            a: [],
            aPatterns: [MONEY_PATTERN],
            b: [
              "sold",
              "sell",
              "selling",
              "sells",
              "made",
              "make",
              "making",
              "makes",
              "charged",
              "charge",
              "charging",
              "paid",
              "pays",
              "client",
              "clients",
              "customer",
              "customers",
              "invoice",
              "invoiced",
              "gig",
              "fiverr",
              "upwork",
            ],
          },
        ],
      },
    ],
    exclusions: CLAUDE_PERSON_EXCLUSIONS,
    wikipedia: null,
    noPublicSeriesReason:
      "No comparable public series. No English Wikipedia article covers “earning money with AI”; a generic article " +
      "such as “Artificial intelligence” would measure a different topic.",
    examples: {
      match: [
        "I sold an AI-generated logo to a client for $80",
        "My AI side hustle hit $4k MRR this month",
        "How I made $12,000 in 30 days with ChatGPT",
        "Claude helped me land 3 paying clients for my copywriting gig",
      ],
      noMatch: [
        "I used AI to organize my notes",
        "ChatGPT Plus costs $20 a month",
        "I made a website with AI this weekend",
        "Earned my first marathon medal today",
        "Sold my Claude Monet print for $500",
      ],
    },
  },
];

export function topicById(id: string): TopicDefinition | undefined {
  return TOPICS.find((t) => t.id === id);
}

export const TOPIC_IDS: readonly string[] = TOPICS.map((t) => t.id);
