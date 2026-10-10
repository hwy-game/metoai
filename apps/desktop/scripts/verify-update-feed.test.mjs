import assert from "node:assert/strict";
import test from "node:test";
import { resolveUpdateFeedBase, verifyUpdateFeed } from "./verify-update-feed.mjs";

const version = "0.5.46";
const metadata = {
	"latest.yml": `version: ${version}\npath: MetoAI-Setup-${version}.exe\nfiles:\n  - url: MetoAI-Setup-${version}.exe\n`,
	"latest-mac.yml": `version: ${version}\nfiles:\n  - url: MetoAI-${version}.zip\n    sha512: test\n`,
	"latest-linux.yml": `version: ${version}\npath: MetoAI-${version}.AppImage\nfiles:\n  - url: MetoAI-${version}.AppImage\n`,
};

function createFetch() {
	const calls = [];
	return {
		calls,
		fetchImpl: async (url, init) => {
			calls.push({ url, method: init.method });
			const fileName = new URL(url).pathname.split("/").at(-1);
			if (fileName in metadata) return { ok: true, status: 200, text: async () => metadata[fileName] };
			return { ok: true, status: 200, text: async () => "" };
		},
	};
}

test("resolves provider-specific public feed bases", () => {
	assert.equal(
		resolveUpdateFeedBase({
			env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version,
		}),
		"https://updates.example.com/desktop/stable/",
	);
	assert.equal(
		resolveUpdateFeedBase({
			env: { VETTA_UPDATE_PROVIDER: "github", VETTA_UPDATE_GITHUB_OWNER: "openvetta", VETTA_UPDATE_GITHUB_REPO: "open-vetta" },
			version,
		}),
		"https://github.com/openvetta/open-vetta/releases/download/v0.5.46/",
	);
});

test("accepts a Git tag version with the leading v", () => {
	assert.equal(
		resolveUpdateFeedBase({
			env: { VETTA_UPDATE_PROVIDER: "github", VETTA_UPDATE_GITHUB_OWNER: "openvetta", VETTA_UPDATE_GITHUB_REPO: "open-vetta" },
		version: "v0.5.46",
		}),
		"https://github.com/openvetta/open-vetta/releases/download/v0.5.46/",
	);
});

test("verifies all platform metadata and referenced artifacts", async () => {
	const fake = createFetch();
	const result = await verifyUpdateFeed({
		env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
		version,
		fetchImpl: fake.fetchImpl,
		retryDelayMs: 0,
	});
	assert.equal(result.metadataFiles.length, 3);
	assert.equal(result.artifacts.length, 3);
	assert.equal(fake.calls.filter((call) => call.method === "GET").length, 3);
	assert.equal(fake.calls.filter((call) => call.method === "HEAD").length, 3);
});

test("falls back to a ranged GET when a CDN rejects HEAD", async () => {
	const fake = createFetch();
	const fetchImpl = async (url, init) => {
		if (init.method === "HEAD") return { ok: false, status: 405, text: async () => "" };
		return fake.fetchImpl(url, init);
	};
	await verifyUpdateFeed({
		env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
		version,
		metadataFiles: ["latest-linux.yml"],
		fetchImpl,
		retryDelayMs: 0,
	});
	assert.ok(fake.calls.some((call) => call.method === "GET"));
});

test("rejects a feed that serves a different release version", async () => {
	const fake = createFetch();
	assert.rejects(
		verifyUpdateFeed({
			env: { VETTA_UPDATE_PROVIDER: "generic", VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable" },
			version: "0.5.47",
			metadataFiles: ["latest.yml"],
			fetchImpl: fake.fetchImpl,
			retryDelayMs: 0,
		}),
		/expected 0\.5\.47/,
	);
});

// mac 是尽力而为平台（见 docs/adr/0122-macos-adhoc-signed-release-builds.md）：release-gate
// 报出的平台清单决定校验范围，缺 mac 不再让发布失败。
test("verifies only the platforms the release gate reported", async () => {
	const fake = createFetch();
	const result = await verifyUpdateFeed({
		env: {
			VETTA_UPDATE_PROVIDER: "generic",
			VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable",
			VETTA_UPDATE_FEED_PLATFORMS: "windows,linux",
		},
		version,
		fetchImpl: fake.fetchImpl,
		retryDelayMs: 0,
	});
	assert.deepEqual(result.metadataFiles, ["latest.yml", "latest-linux.yml"]);
	assert.equal(
		fake.calls.some((call) => call.url.endsWith("latest-mac.yml")),
		false,
	);
});

test("verifies a macOS-only release feed when that is the only platform built", async () => {
	const fake = createFetch();
	const result = await verifyUpdateFeed({
		env: {
			VETTA_UPDATE_PROVIDER: "generic",
			VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable",
			VETTA_UPDATE_FEED_PLATFORMS: "macos",
		},
		version,
		fetchImpl: fake.fetchImpl,
		retryDelayMs: 0,
	});
	assert.deepEqual(result.metadataFiles, ["latest-mac.yml"]);
});

// 收窄范围不等于放宽校验：清单里列出的每个平台都必须单独过。
test("still checks every reported platform instead of passing on the first one", async () => {
	const fetchImpl = async (url) => {
		const fileName = new URL(url).pathname.split("/").at(-1);
		if (fileName === "latest-linux.yml") {
			return { ok: true, status: 200, text: async () => `version: 0.5.47\npath: x\nfiles:\n  - url: x\n` };
		}
		return { ok: true, status: 200, text: async () => metadata[fileName] ?? "" };
	};
	await assert.rejects(
		verifyUpdateFeed({
			env: {
				VETTA_UPDATE_PROVIDER: "generic",
				VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable",
				VETTA_UPDATE_FEED_PLATFORMS: "windows,linux",
			},
			version,
			fetchImpl,
			retryDelayMs: 0,
		}),
		/latest-linux\.yml has version 0\.5\.47/,
	);
});

test("rejects an unsupported platform name in VETTA_UPDATE_FEED_PLATFORMS", async () => {
	const fake = createFetch();
	await assert.rejects(
		verifyUpdateFeed({
			env: {
				VETTA_UPDATE_PROVIDER: "generic",
				VETTA_UPDATE_URL: "https://updates.example.com/desktop/stable",
				VETTA_UPDATE_FEED_PLATFORMS: "windows,plan9",
			},
			version,
			fetchImpl: fake.fetchImpl,
			retryDelayMs: 0,
		}),
		/VETTA_UPDATE_FEED_PLATFORMS contains unsupported platform "plan9"/,
	);
	assert.equal(fake.calls.length, 0);
});
