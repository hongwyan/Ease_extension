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
 * Word boundaries are script-aware: a Latin term only needs non-Latin letters
 * around it ("ChatGPTで" matches), and Chinese/Japanese/Korean/Thai terms match
 * as substrings because those scripts do not separate words with spaces.
 * Terms are plain phrases; a space in a term also matches "-" or "_".
 * `*` at the end of a term is a word-prefix wildcard ("monetiz*").
 *
 * Multilingual vocabulary lives in VOCAB below, one block per language. Add a
 * language by adding a block and examples; `vocabularyLanguages` is derived.
 */

export const CATALOG_VERSION = "2026.11.2";

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
  /** Languages (besides English) with dedicated vocabulary for this topic. */
  vocabularyLanguages: string[];
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

/**
 * Per-language vocabulary. Keys are normalized X language codes (see language.ts).
 * - chatgpt / claude: local spellings of the tool names (Latin "ChatGPT" works in every language already)
 * - claudeContext: AI context words that make a bare "Claude" count as Anthropic's Claude
 * - ai / income / transaction: evidence for the "earning money with AI" claim
 * - personExclusions: people named Claude, removed before matching
 * Matching does not depend on the post's language tag: every term is tried on every post.
 */
interface LanguageVocab {
  chatgpt?: string[];
  claude?: string[];
  claudeContext?: string[];
  ai?: string[];
  income?: string[];
  transaction?: string[];
  personExclusions?: string[];
}

export const VOCAB: Record<string, LanguageVocab> = {
  es: {
    claudeContext: ["ia", "inteligencia artificial", "modelo"],
    ai: ["ia", "inteligencia artificial"],
    income: ["ganar dinero", "gané", "ganando dinero", "gana dinero", "ganancias", "ingresos", "ingreso pasivo", "ingresos pasivos", "facturé", "facturación", "generar ingresos"],
    transaction: ["vendí", "vendiendo", "vendo", "cobré", "cobrando", "cliente", "clientes"],
  },
  pt: {
    claudeContext: ["ia", "inteligência artificial", "modelo"],
    ai: ["ia", "inteligência artificial"],
    income: ["ganhar dinheiro", "ganhei", "ganhando dinheiro", "renda extra", "renda passiva", "faturei", "faturamento", "lucro", "lucrei"],
    transaction: ["vendi", "vendendo", "cobrei", "cliente", "clientes"],
  },
  fr: {
    claudeContext: ["ia", "intelligence artificielle", "modèle"],
    ai: ["ia", "intelligence artificielle"],
    income: ["gagner de l'argent", "gagné", "gagne de l'argent", "revenus", "revenu passif", "chiffre d'affaires", "bénéfices"],
    transaction: ["vendu", "vends", "facturé", "client", "clients"],
  },
  de: {
    claudeContext: ["ki", "künstliche intelligenz", "modell"],
    ai: ["künstliche intelligenz", "ki generiert", "ki generierte", "ki tool*", "ki bild*", "mit ki", "dank ki"],
    income: ["geld verdienen", "verdient", "verdiene", "einnahmen", "einkommen", "passives einkommen", "nebeneinkommen", "umsatz", "gewinn"],
    transaction: ["verkauft", "verkaufe", "kunde", "kunden", "rechnung"],
  },
  it: {
    claudeContext: ["ia", "intelligenza artificiale", "modello"],
    ai: ["ia", "intelligenza artificiale"],
    income: ["guadagnare", "guadagnato", "guadagno", "guadagni", "entrate", "reddito passivo", "fatturato"],
    transaction: ["venduto", "cliente", "clienti"],
  },
  ja: {
    chatgpt: ["チャットgpt", "チャットジーピーティー"],
    claude: ["クロード"],
    claudeContext: ["人工知能", "アンソロピック", "プロンプト", "モデル", "チャットボット"],
    ai: ["人工知能", "チャットボット"],
    income: ["稼", "儲", "収入", "収益", "副業", "不労所得", "売上", "月収", "年収", "マネタイズ"],
    transaction: ["売", "販売", "案件", "受注", "クライアント", "納品"],
    personExclusions: ["クロード・モネ", "クロード モネ", "モネ", "クロード・ドビュッシー", "ジャン=クロード", "ジャン・クロード"],
  },
  ko: {
    chatgpt: ["챗gpt", "챗지피티"],
    claude: ["클로드"],
    claudeContext: ["인공지능", "앤트로픽", "프롬프트", "모델", "챗봇"],
    ai: ["인공지능", "생성형"],
    income: ["돈 벌", "돈벌", "벌었", "벌기", "수익", "부업", "매출", "월수익"],
    transaction: ["팔았", "판매", "클라이언트", "고객"],
    personExclusions: ["클로드 모네", "모네", "클로드 드뷔시"],
  },
  zh: {
    chatgpt: ["聊天gpt"],
    claudeContext: ["人工智能", "人工智慧", "大模型", "提示词", "模型"],
    ai: ["人工智能", "人工智慧", "大模型"],
    income: ["赚钱", "赚了", "賺錢", "賺了", "收入", "收益", "副业", "副業", "被动收入", "被動收入", "营收", "營收", "月入", "变现", "變現"],
    transaction: ["卖", "賣", "客户", "客戶", "接单", "接單"],
    personExclusions: ["克劳德·莫奈", "莫奈"],
  },
  ru: {
    chatgpt: ["чатгпт", "чат gpt", "чат гпт"],
    claude: ["клод*"],
    claudeContext: ["нейросет*", "ии", "антропик", "модель", "промпт*"],
    ai: ["ии", "искусственный интеллект", "искусственного интеллекта", "нейросет*", "нейронк*"],
    income: ["заработ*", "доход*", "пассивный доход", "выручк*", "прибыл*", "монетиз*"],
    transaction: ["продал*", "продаж*", "клиент*", "заказчик*"],
    personExclusions: ["клод моне", "моне", "клод дебюсси", "жан-клод"],
  },
  tr: {
    ai: ["yapay zeka*", "yapay zekâ*"],
    income: ["para kazan*", "kazandım", "kazanç", "gelir", "pasif gelir", "ek gelir"],
    transaction: ["sattım", "satış", "müşteri*"],
  },
  id: {
    ai: ["kecerdasan buatan"],
    income: ["menghasilkan uang", "cuan", "penghasilan", "pendapatan", "dapat uang", "dapet duit", "omzet"],
    transaction: ["jual", "jualan", "menjual", "klien", "pelanggan"],
  },
  hi: {
    chatgpt: ["चैटजीपीटी", "चैट जीपीटी"],
    ai: ["एआई", "आर्टिफिशियल इंटेलिजेंस", "कृत्रिम बुद्धिमत्ता"],
    income: ["कमाई", "कमाए", "कमाता", "कमाना", "पैसे कमा*", "आमदनी"],
    transaction: ["बेचा", "बेचे", "क्लाइंट", "ग्राहक"],
  },
  ar: {
    chatgpt: ["شات جي بي تي", "تشات جي بي تي"],
    claude: ["كلود"],
    claudeContext: ["الذكاء الاصطناعي", "أنثروبيك", "نموذج"],
    ai: ["الذكاء الاصطناعي", "ذكاء اصطناعي"],
    income: ["ربح*", "أرباح", "الأرباح", "دخل", "دخل سلبي", "كسبت"],
    transaction: ["بعت", "بيع", "عميل", "عملاء"],
    personExclusions: ["كلود مونيه", "مونيه"],
  },
  vi: {
    ai: ["trí tuệ nhân tạo"],
    income: ["kiếm tiền", "thu nhập", "doanh thu", "lợi nhuận"],
    transaction: ["bán", "khách hàng"],
  },
};

function fromVocab(field: keyof LanguageVocab): string[] {
  return Object.values(VOCAB).flatMap((v) => v[field] ?? []);
}

function languagesWith(...fields: (keyof LanguageVocab)[]): string[] {
  return Object.entries(VOCAB)
    .filter(([, v]) => fields.some((f) => (v[f]?.length ?? 0) > 0))
    .map(([k]) => k);
}

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
      ...fromVocab("personExclusions"),
    ];

/**
 * Money amounts: symbol first ("$80", "R$ 2.000", "₹500", "€3.000"), currency word
 * after ("500 dólares", "30万円", "2万元", "50 000 рублей", "3.000 €"), or "Rp 5 juta" / "5 juta".
 */
const MONEY_PATTERN = [
  "(?:R\\$|[$€£¥₹₩₺₽₫])\\s?\\d[\\d,.\\s]*(?:k|m|mil|million|thousand|万|億|juta|ribu)?",
  "\\d[\\d,.\\s]*(?:k|m|mil|万|億|만|천)?\\s?(?:usd|eur|dollars?|dolar|euros?|pounds|bucks|dólares|dolares|reais|pesos|lira|tl|rupees?|rupiah|円|元|원|руб\\S*|₽|€|\\$)",
  "(?:\\brp\\.?\\s?)?\\d[\\d.,]*\\s?(?:juta|ribu|rb|jt)\\b",
]
  .map((p) => `(?:${p})`)
  .join("|");

export const TOPICS: TopicDefinition[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    kind: "tool",
    phrase: "mentioned ChatGPT",
    priority: 1,
    rule:
      "Mentions ChatGPT by name in any language (“ChatGPT”, “Chat GPT”, “#ChatGPT”), " +
      "including local spellings such as チャットGPT, 챗GPT, ЧатГПТ, चैटजीपीटी and شات جي بي تي.",
    strongAliases: ["chatgpt", "chat gpt", "chatgpt plus", "chatgpt pro", "chatgpt atlas", ...fromVocab("chatgpt")],
    exclusions: [],
    vocabularyLanguages: languagesWith("chatgpt"),
    wikipedia: {
      article: "ChatGPT",
      justification: "The English Wikipedia article about the ChatGPT chatbot itself.",
    },
    examples: {
      match: [
        "ChatGPT just wrote my whole cover letter",
        "Asked chat gpt to plan my week",
        "Top 10 #ChatGPT prompts for founders",
        "ChatGPTで資料を作った",
        "챗GPT로 보고서를 썼다",
        "Le pregunté a ChatGPT por la receta",
        "Спросил ЧатГПТ про отпуск",
        "ＣｈａｔＧＰＴに聞いてみた",
      ],
      noMatch: ["GPT stands for GUID Partition Table on disks", "chat with me about gardening", "チャットで話そう"],
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
      "or “Claude” (also クロード, 클로드, Клод, كلود) together with an AI context word (Anthropic, AI, LLM, model, prompt, " +
      "chatbot, or the same words in the post's language). People named Claude (Monet, Debussy, Van Damme…) are excluded.",
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
    weakAliases: ["claude", ...fromVocab("claude")],
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
      ...fromVocab("claudeContext"),
    ],
    exclusions: CLAUDE_PERSON_EXCLUSIONS,
    vocabularyLanguages: languagesWith("claude", "claudeContext"),
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
        "Claude Codeでリファクタリングした",
        "クロードとChatGPTを比べてみた",
        "Попросил Клода переписать промпт для нейросети",
        "Probé Claude, la IA de Anthropic, para resumir contratos",
        "Claude ist die beste KI für lange Texte",
      ],
      noMatch: [
        "Claude Monet's water lilies at the Orangerie",
        "Watching a Jean-Claude Van Damme marathon tonight",
        "My neighbour Claude fixed my bike",
        "An AI-generated poster of a Claude Monet painting",
        "クロード・モネの睡蓮を見た",
        "Клод Моне — великий художник",
        "Mi vecino Claude arregló mi bici",
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
      "or a money amount together with a sale/payment word (sold, made, charged, paid, client, customer). " +
      "The same evidence words are recognized in Spanish, Portuguese, French, German, Italian, Japanese, Korean, " +
      "Chinese, Russian, Turkish, Indonesian, Hindi, Arabic and Vietnamese.",
    requireAll: [
      { name: "AI evidence", terms: [...AI_TERMS, ...fromVocab("ai")] },
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
          ...fromVocab("income"),
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
              ...fromVocab("transaction"),
            ],
          },
        ],
      },
    ],
    exclusions: CLAUDE_PERSON_EXCLUSIONS,
    vocabularyLanguages: languagesWith("ai", "income", "transaction"),
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
        "Gané 500 dólares vendiendo logos hechos con IA",
        "AIで月収30万円稼いだ方法",
        "Ganhei R$ 2.000 de renda extra usando inteligência artificial",
        "Mit KI-Tools verdiene ich 3.000 € im Monat",
        "用AI一个月赚了2万元",
        "Заработал 50 000 рублей на нейросетях",
        "Yapay zeka ile ayda 1000 dolar para kazandım",
        "Dapat cuan 5 juta dari jualan desain pakai AI",
      ],
      noMatch: [
        "I used AI to organize my notes",
        "ChatGPT Plus costs $20 a month",
        "I made a website with AI this weekend",
        "Earned my first marathon medal today",
        "Sold my Claude Monet print for $500",
        "AIでメモを整理した",
        "Usé IA para organizar mis notas",
        "ChatGPTの料金は月3000円",
        "Gané el partido de fútbol",
        "Mit KI habe ich meine Notizen sortiert",
      ],
    },
  },
];

export function topicById(id: string): TopicDefinition | undefined {
  return TOPICS.find((t) => t.id === id);
}

export const TOPIC_IDS: readonly string[] = TOPICS.map((t) => t.id);
