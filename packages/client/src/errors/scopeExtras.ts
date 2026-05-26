import type { SCOPES } from "./scopes";

type ScopeOf<S extends keyof typeof SCOPES> = (typeof SCOPES)[S];
type ExtrasFrom<S extends keyof typeof SCOPES> =
  ScopeOf<S> extends { extrasFrom: infer F } ? F : undefined;

export type ScopeExtras<S extends keyof typeof SCOPES> =
  ExtrasFrom<S> extends (err: never) => infer R ? Exclude<R, undefined> : never;
