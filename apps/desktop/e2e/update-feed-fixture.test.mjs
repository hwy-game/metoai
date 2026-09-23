import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { incrementPatch, startUpdateFeedFixture, updatePolicyFixture } from "./update-feed-fixture.mjs";

const runningServers = new Set();

afterEach(async () => {
	await Promise.all(
		[...runningServers].map(
			(server) =>
				new Promise((resolve) => {
					server.close(resolve);
				}),
		),
	);
	runningServers.clear();
});

test("packaged E2E update feed serves platform metadata with the requested version", async () => {
	const fixture = await startUpdateFeedFixture("0.5.46");
	runningServers.add(fixture.server);

	const response = await fetch(`${fixture.url}latest-linux.yml`);
	const body = await response.text();

	assert.equal(response.status, 200);
	assert.match(body, /version: 0\.5\.46/);
	assert.match(body, /sha512:/);
});

test("packaged E2E update feed rejects non-metadata paths", async () => {
	const fixture = await startUpdateFeedFixture("0.5.46");
	runningServers.add(fixture.server);

	assert.equal((await fetch(`${fixture.url}artifact.zip`)).status, 404);
});

test("packaged E2E update feed serves a checksum-bearing downloadable fixture", async () => {
	const fixture = await startUpdateFeedFixture({ version: "0.5.46", downloadable: true });
	runningServers.add(fixture.server);

	const metadata = await (await fetch(`${fixture.url}latest-linux.yml`)).text();
	const artifact = await (await fetch(`${fixture.url}Metoai-e2e-update.AppImage`)).arrayBuffer();

	assert.match(metadata, /version: 0\.5\.47/);
	assert.equal(Buffer.from(artifact).toString("utf8"), "vetta-packaged-e2e-update\n");
});

test("packaged E2E update feed rejects an invalid metadata delay", async () => {
	await assert.rejects(
		startUpdateFeedFixture({ version: "0.5.46", metadataDelayMs: -1 }),
		/Invalid E2E fixture metadata delay/,
	);
});

test("packaged E2E policy fixture registers one patch above the running version", () => {
	assert.equal(incrementPatch("0.5.61"), "0.5.62");
	assert.throws(() => incrementPatch("0.5"), /Invalid E2E fixture version/);
});

test("packaged E2E policy fixture registers a version without a download url", () => {
	assert.deepEqual(updatePolicyFixture("0.5.62"), {
		has_update: true,
		forced: false,
		reason: "",
		check_interval_seconds: 3_600,
		latest: { version: "0.5.62" },
	});
});
