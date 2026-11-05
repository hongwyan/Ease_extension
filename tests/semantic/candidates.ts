import type { EncoderSpec } from "../../src/semantic/encoder";

/** Candidate encoders benchmarked on the fixture (all pinned in scripts/models.lock.json). */
export const CANDIDATES: Record<string, Omit<EncoderSpec, "revision">> = {
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2": { modelId: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", dtype: "q8", pooling: "mean", maxTokens: 128, maxChunks: 4, prefix: "" },
  "Xenova/multilingual-e5-small": { modelId: "Xenova/multilingual-e5-small", dtype: "q8", pooling: "mean", maxTokens: 512, maxChunks: 1, prefix: "query: " },
  "onnx-community/granite-embedding-97m-multilingual-r2-ONNX": {
    modelId: "onnx-community/granite-embedding-97m-multilingual-r2-ONNX",
    dtype: "q8",
    pooling: "cls",
    maxTokens: 512,
    maxChunks: 1,
    prefix: "",
  },
  "Xenova/paraphrase-multilingual-mpnet-base-v2": { modelId: "Xenova/paraphrase-multilingual-mpnet-base-v2", dtype: "q8", pooling: "mean", maxTokens: 128, maxChunks: 4, prefix: "" },
  "onnx-community/gte-multilingual-base": { modelId: "onnx-community/gte-multilingual-base", dtype: "q8", pooling: "cls", maxTokens: 512, maxChunks: 1, prefix: "" },
  "onnx-community/gte-multilingual-base@256x4": { modelId: "onnx-community/gte-multilingual-base", dtype: "q8", pooling: "cls", maxTokens: 256, maxChunks: 4, prefix: "" },
  "onnx-community/gte-multilingual-base@128x8": { modelId: "onnx-community/gte-multilingual-base", dtype: "q8", pooling: "cls", maxTokens: 128, maxChunks: 8, prefix: "" },
  "onnx-community/gte-multilingual-base@96x8": { modelId: "onnx-community/gte-multilingual-base", dtype: "q8", pooling: "cls", maxTokens: 96, maxChunks: 8, prefix: "" },
  "Snowflake/snowflake-arctic-embed-m-v2.0": { modelId: "Snowflake/snowflake-arctic-embed-m-v2.0", dtype: "q8", pooling: "cls", maxTokens: 512, maxChunks: 1, prefix: "query: " },
};
