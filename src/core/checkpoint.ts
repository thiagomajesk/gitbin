import { Schema } from "effect";
export const CheckpointFile = Schema.Struct({
  id: Schema.String,
  path: Schema.NullOr(Schema.String),
  hash: Schema.String,
});
export type CheckpointFile = typeof CheckpointFile.Type;
