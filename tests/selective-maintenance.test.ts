import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { emptyHistory } from "../src/core/history";
import { consolidation } from "../src/git/consolidation";
import { decoded, encoded, SelectiveDevice, selectiveLimits } from "./selective-fixture";
import { realSelectiveFixture } from "./selective-git-fixture";

it.effect("consolidates every vault while a returning device publishes its offline edits", () =>
  Effect.gen(function* () {
    const fixture = yield* realSelectiveFixture();
    const a = yield* fixture.connect();
    a.device.files.set("Note.md", encoded("original"));
    a.device.files.set("Image.bin", new Uint8Array([0, 255, 42]));
    yield* a.engine.sync();
    const offline = yield* fixture.connect();
    yield* offline.engine.sync();
    offline.device.files.set("Note.md", encoded("offline replacement"));
    yield* offline.engine.capture();
    const work = yield* fixture.connect(new SelectiveDevice(), "work");
    work.device.files.set("Work.md", encoded("keep work"));
    yield* work.engine.sync();
    const oldHead = yield* fixture.git(["rev-parse", "main"]);
    const preview = yield* fixture.maintenance.preview();
    expect(preview.vaults).toEqual(["personal", "work"]);
    yield* fixture.maintenance.apply(preview.sourceRevision, preview.revision);
    expect(yield* fixture.git(["rev-list", "--count", "main"])).toBe("1");
    yield* offline.engine.sync();
    expect(yield* fixture.git(["show", "main:personal/Note.md"])).toBe("offline replacement");
    expect(offline.device.files.get("Image.bin")).toEqual(new Uint8Array([0, 255, 42]));
    expect(yield* fixture.git(["show", "main:work/Work.md"])).toBe("keep work");
    expect((yield* fixture.git(["rev-list", "main"])).split(/\s+/)).not.toContain(oldHead);
  }),
);

const scenarios = ["unchanged", "edit", "delete", "rename", "conflict", "remote-delete"];

it.effect("maintenance prepares files larger than the device download limit", () =>
  Effect.gen(function* () {
    const fixture = yield* realSelectiveFixture();
    const limits = { ...selectiveLimits, downloadBytes: 2 };
    const device = yield* fixture.connect(new SelectiveDevice(), "personal", limits);
    const bytes = encoded("keep the original committed note");
    device.device.files.set("Note.md", bytes);
    yield* device.engine.sync();
    const before = yield* fixture.git(["rev-parse", "main"]);
    const service = consolidation(fixture.connection);
    for (const roots of [undefined, ["personal"]]) {
      const preview = yield* service.preview(null, roots);
      expect(preview.repository.files.get("personal/Note.md")).toEqual(bytes);
    }
    expect(yield* fixture.git(["rev-parse", "main"])).toBe(before);
  }),
);

for (const operation of ["consolidate", "reinitialize"])
  for (const scenario of scenarios) {
    it.effect(`reconciles ${scenario} after ${operation} and restart`, () =>
      Effect.gen(function* () {
        const fixture = yield* realSelectiveFixture();
        const desktop = yield* fixture.connect();
        desktop.device.files.set("Note.md", encoded("original"));
        yield* desktop.engine.sync();
        const offline = yield* fixture.connect();
        yield* offline.engine.sync();
        yield* offlineChanges(offline, scenario);
        if (["unchanged", "conflict", "rename"].includes(scenario))
          desktop.device.files.set("Note.md", encoded("desktop edit"));
        if (scenario === "remote-delete") desktop.device.files.delete("Note.md");
        yield* desktop.engine.sync();
        const preview = yield* fixture.maintenance.preview(
          null,
          operation === "reinitialize" ? ["personal"] : undefined,
        );
        yield* fixture.maintenance.apply(preview.sourceRevision, preview.revision);
        if (offline.device.journal)
          offline.device.journal = { ...offline.device.journal, history: emptyHistory() };
        const restarted = yield* fixture.connect(offline.device);
        yield* restarted.engine.sync();
        assertResult(scenario, restarted.device);
        expect(restarted.device.journal?.metadata.consolidationHash).toBe(
          preview.consolidationHash,
        );
        const before = new Map(restarted.device.files);
        yield* restarted.engine.sync();
        expect(restarted.device.files).toEqual(before);
      }),
    );
  }
type Client = Effect.Success<
  ReturnType<Effect.Success<ReturnType<typeof realSelectiveFixture>>["connect"]>
>;
const offlineChanges = Effect.fn("fixture.offlineChanges")(function* (
  offline: Client,
  scenario: string,
) {
  if (["edit", "conflict"].includes(scenario))
    offline.device.files.set("Note.md", encoded("offline edit"));
  if (scenario === "delete") offline.device.files.delete("Note.md");
  if (scenario === "rename") {
    offline.device.files.delete("Note.md");
    offline.device.files.set("Renamed.md", encoded("original"));
    yield* offline.engine.rename("Note.md", "Renamed.md");
  }
  yield* offline.engine.capture();
});
function assertResult(scenario: string, device: SelectiveDevice): void {
  const contents = [...device.files.values()].map(decoded);
  if (scenario === "unchanged") expect(contents).toEqual(["desktop edit"]);
  if (scenario === "edit") expect(contents).toEqual(["offline edit"]);
  if (["delete", "remote-delete"].includes(scenario)) expect(device.files.size).toBe(0);
  if (scenario === "rename") expect(decoded(device.files.get("Renamed.md"))).toBe("desktop edit");
  if (scenario === "conflict") expect(contents.sort()).toEqual(["desktop edit", "offline edit"]);
}
