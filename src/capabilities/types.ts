declare const capabilityType: unique symbol;

/** A namespaced identity carrying a capability's compile-time value type. */
export interface CapabilityKey<T extends object> {
  readonly id: `${string}:${string}`;
  readonly [capabilityType]?: T;
}

/** A plugin-provided capability whose type is recovered through its key. */
export interface CapabilityEntry {
  readonly key: CapabilityKey<object>;
  readonly value: object;
}
