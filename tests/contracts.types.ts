import type { DocumentSession } from "../src/index.ts";
import type { CapabilityKey } from "../src/sdk/index.ts";

export function checkSessionTypes(
  session: DocumentSession,
  key: CapabilityKey<{ text(): string }>,
): void {
  const snapshot = session.getSnapshot();
  if (snapshot.status === "ready") {
    const id: string = snapshot.pluginId;
    void id;
  }
  if (snapshot.status === "error" || snapshot.status === "cancelled") {
    void snapshot.error.code;
  }
  const content: string | undefined = session.getCapability(key)?.text();
  void content;
  // @ts-expect-error Capabilities preserve their declared return types.
  const wrong: number = session.getCapability(key)?.text();
  void wrong;
  // @ts-expect-error Legacy save does not imply persistence in the managed API.
  void session.save;
}
