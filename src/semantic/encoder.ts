import { AutoModel, AutoTokenizer, type PreTrainedModel, type PreTrainedTokenizer } from "@huggingface/transformers";
import { aggregate, clsPool, l2normalize, meanPool, planChunks } from "./core";

/**
 * Real local text encoder (Transformers.js + ONNX Runtime). The packaged inference worker
 * and the Node evaluation harness both use this class, so chunking, pooling and
 * normalization are the same code path. No mock or keyword fallback exists.
 */

export interface EncoderSpec {
  modelId: string;
  revision: string;
  dtype: "q8";
  pooling: "mean" | "cls";
  /** Token budget per chunk, special tokens included (the model's training sequence length). */
  maxTokens: number;
  /** Chunks per text; tokens beyond maxTokens × maxChunks are not encoded (reported as truncated). */
  maxChunks: number;
  /** Text prepended to every input (e.g. "query: " for E5-style models). */
  prefix: string;
}

export interface Embedding {
  vec: Float32Array;
  /** Tokens actually encoded, summed over chunks. */
  tokens: number;
  chunks: number;
  truncated: boolean;
}

/** Inputs per forward pass. Small batches keep latency per batch low and padding waste small. */
const FORWARD_BATCH = 8;

export class TransformersEncoder {
  private constructor(
    readonly spec: EncoderSpec,
    private readonly tokenizer: PreTrainedTokenizer,
    private readonly model: PreTrainedModel,
  ) {}

  static async load(spec: EncoderSpec, device: "wasm" | "cpu"): Promise<TransformersEncoder> {
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(spec.modelId, { local_files_only: true }),
      AutoModel.from_pretrained(spec.modelId, { dtype: spec.dtype, device, local_files_only: true }),
    ]);
    return new TransformersEncoder(spec, tokenizer, model);
  }

  countTokens(text: string): number {
    return this.tokenizer.encode(this.spec.prefix + text).length;
  }

  /** Encodes already-preprocessed texts. One unit vector per input text. */
  async embed(texts: string[]): Promise<Embedding[]> {
    const plans = texts.map((t) => planChunks(t, (s) => this.countTokens(s), this.spec.maxTokens, this.spec.maxChunks));
    const flat: { text: string; owner: number; tokens: number }[] = [];
    plans.forEach((p, owner) => p.chunks.forEach((c, i) => flat.push({ text: this.spec.prefix + c, owner, tokens: p.tokens[i]! })));
    // Similar lengths share a forward pass to limit padding.
    const order = flat.map((_, i) => i).sort((a, b) => flat[a]!.tokens - flat[b]!.tokens);
    const vecs: Float32Array[] = new Array(flat.length);
    for (let i = 0; i < order.length; i += FORWARD_BATCH) {
      const idx = order.slice(i, i + FORWARD_BATCH);
      const inputs = this.tokenizer(
        idx.map((k) => flat[k]!.text),
        { padding: true, truncation: true, max_length: this.spec.maxTokens },
      );
      const out = await this.model(inputs);
      const hidden = (out.last_hidden_state ?? out.token_embeddings) as { data: Float32Array; dims: number[] };
      const mask = (inputs.attention_mask as { data: ArrayLike<number | bigint> }).data;
      const pooled = this.spec.pooling === "cls" ? clsPool(hidden.data, hidden.dims) : meanPool(hidden.data, hidden.dims, mask);
      idx.forEach((k, j) => (vecs[k] = l2normalize(pooled[j]!)));
      for (const t of Object.values(out)) (t as { dispose?: () => void }).dispose?.();
    }
    return plans.map((p, owner) => ({
      vec: aggregate(flat.flatMap((f, k) => (f.owner === owner ? [vecs[k]!] : []))),
      tokens: p.tokens.reduce((s, n) => s + n, 0),
      chunks: p.chunks.length,
      truncated: p.truncated,
    }));
  }

  async dispose(): Promise<void> {
    await this.model.dispose();
  }
}
