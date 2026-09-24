import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-release.yml"), "utf8");
const packagedWorkflow = readFileSync(
	join(import.meta.dirname, "../../.github/workflows/desktop-packaged.yml"),
	"utf8",
);
const upgradeWorkflow = readFileSync(
	join(import.meta.dirname, "../../.github/workflows/desktop-upgrade-e2e.yml"),
	"utf8",
);

/**
 * 抽出 `docker run ... -c '<脚本>'` 的脚本体。这些脚本整体由外层单引号包裹，脚本内再
 * 出现单引号会提前闭合外层引号，外层 shell 随后会吃掉反斜杠（`-printf '%h\n'` 实际变成
 * `-printf %hn`），容器检查就会在没有任何输出的情况下失败。
 */
function dockerContainerScripts(workflowSource) {
	return [...workflowSource.matchAll(/-c '\r?\n([\s\S]*?)\r?\n\s*'\r?\n/g)].map((match) => match[1]);
}

const require = createRequire(join(import.meta.dirname, "../../apps/desktop/package.json"));
const { parse } = require("yaml");
const jobs = parse(workflow).jobs;
function actionSteps(name) {
	return parse(readFileSync(join(import.meta.dirname, `../../.github/actions/${name}/action.yml`), "utf8")).runs.steps;
}

/**
 * 上游那两条 checkpoint 测试直接执行 workflow 里的 shell 脚本，只有 bash 可用时才有意义。
 * Windows 上没装 Git Bash 时跳过，免得本地 `bun run check` 直接抛 spawnSync bash ENOENT；
 * Linux CI 上仍然照跑。
 */
const hasBash = (() => {
	try {
		execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

describe("Desktop release workflow contracts", () => {
	it("saves successful dependency downloads before later build or verification failures", () => {
		const steps = actionSteps("install-bun-dependencies");
		const restore = steps.findIndex((step) => step.uses === "actions/cache/restore@v4");
		const install = steps.findIndex((step) => step.run?.includes("install-ci-dependencies.mjs"));
		const save = steps.findIndex((step) => step.uses === "actions/cache/save@v4");
		expect(restore).toBeLessThan(install);
		expect(install).toBeLessThan(save);
		expect(steps[save].if).toBe("steps.bun-cache.outputs.cache-hit != 'true'");
		expect(steps[restore].with.path).toBe("~/.bun/install/cache");
		expect(steps[restore].with.key).toContain("runner.arch");
	});

	it("isolates model inputs and saves resources before compilation without caching application outputs", () => {
		const steps = actionSteps("prepare-desktop-resources");
		const restore = steps.find((step) => step.uses === "actions/cache/restore@v4");
		expect(restore.with["restore-keys"]).toBeUndefined();
		for (const input of [
			"runtimes/manifest.json",
			"speech-input/model-manifest.json",
			"fetch-ocr-models.js",
			"runner.arch",
		]) {
			expect(restore.with.key).toContain(input);
		}
		const save = steps.findIndex((step) => step.uses === "actions/cache/save@v4");
		expect(steps.findIndex((step) => step.name === "Download release resources")).toBeLessThan(save);
		expect(steps[save].with.path).toBe(restore.with.path);
		expect(restore.with.path).not.toMatch(/node_modules|build-stage|\.turbo|release\//);
		expect(
			jobs.build.steps.findIndex((step) => step.uses === "./.github/actions/prepare-desktop-resources"),
		).toBeLessThan(jobs.build.steps.findIndex((step) => step.name === "Build updater artifacts"));
	});

	it("retries verification using the same run's completed build without packaging again", () => {
		expect(jobs.build.strategy["fail-fast"]).toBe(false);
		expect(jobs.verify?.needs).toEqual(["prepare", "build"]);
		expect(jobs.verify?.strategy.matrix).toEqual(jobs.build.strategy.matrix);
		const buildSteps = jobs.build.steps;
		const verifySteps = jobs.verify?.steps ?? [];
		expect(buildSteps.some((step) => step.name === "Run packaged app and updater E2E")).toBe(false);
		const checkpoint = buildSteps.find((step) => step.name === "Upload build checkpoint");
		expect(checkpoint?.with.name).toBe("release-build-$" + "{{ matrix.platform }}");
		expect(checkpoint?.with["retention-days"]).toBe(30);
		expect(checkpoint?.with.overwrite).toBe(true);
		const download = verifySteps.find((step) => step.uses === "actions/download-artifact@v4");
		expect(download?.with.name).toBe(checkpoint?.with.name);
		expect(download?.with["run-id"]).toBeUndefined();
		expect(verifySteps.some((step) => step.run?.includes("matrix.command"))).toBe(false);
		expect(verifySteps.findIndex((step) => step.name === "Restore build checkpoint")).toBeLessThan(
			verifySteps.findIndex((step) => step.name === "Verify platform updater artifacts"),
		);
		// Windows 上 Git Bash 的 GNU tar 不认 `D:\a\...` 这类反斜杠路径：解包时把
		// ${GITHUB_WORKSPACE} 原样交给 -C 会以 "Cannot open: No such file or directory"
		// 退出码 2 失败（创建检查点那一步恰好能过，只看构建结果发现不了）。两步都必须先把
		// 路径换成正斜杠；脚本里也不能出现字面反斜杠——脚本经 `bash -c` 传递时 Windows 的
		// 命令行引号会把它们吃掉，所以统一用 cygpath，而不是 ${VAR//\\//}。
		for (const step of [
			buildSteps.find((candidate) => candidate.name === "Archive build checkpoint"),
			verifySteps.find((candidate) => candidate.name === "Restore build checkpoint"),
		]) {
			expect(step.run).toMatch(/-C "\$\{WORKSPACE\}\/apps\/desktop"/);
			expect(step.run).not.toMatch(/-C "\$\{GITHUB_WORKSPACE\}/);
			expect(step.run).toContain("cygpath -m");
		}
		for (const target of ["publish-r2", "publish-github"]) {
			// publish 等的是 release-gate：由它汇总各平台产出的 updater 元数据，并把
			// built-platforms 交给 publish 里的 feed 校验；gate 自己 needs [prepare, build, verify]，
			// 所以「先验证、再发布」这条约束仍然成立。
			expect(jobs[target].needs).toContain("release-gate");
			expect(jobs["release-gate"].needs).toContain("verify");
			expect(jobs[target].steps.find((step) => step.uses === "actions/download-artifact@v4").with.pattern).toBe(
				"desktop-*",
			);
		}
	});

	it.skipIf(!hasBash)(
		"restores a failed verification attempt with original bytes, executable modes, symlinks and candidate version",
		() => {
			const root = mkdtempSync(join(tmpdir(), "vetta-release-checkpoint-"));
			try {
				const desktop = join(root, "apps/desktop");
				const release = join(desktop, "release");
				const runnerTemp = join(root, "runner");
				mkdirSync(release, { recursive: true });
				mkdirSync(runnerTemp);
				writeFileSync(join(desktop, "package.json"), JSON.stringify({ version: "0.5.58" }));
				writeFileSync(join(release, "Vetta"), "signed executable fixture");
				chmodSync(join(release, "Vetta"), 0o755);
				if (process.platform !== "win32") symlinkSync("Vetta", join(release, "bundle-link"));
				writeFileSync(join(release, "latest.yml"), "version: 0.5.59\n");
				writeFileSync(join(release, "installer.exe.files.json"), "verification manifest");
				const envFile = join(root, "github-env");
				const env = {
					...process.env,
					RUNNER_TEMP: runnerTemp,
					GITHUB_WORKSPACE: root,
					GITHUB_ENV: envFile,
					VETTA_REQUIRE_MAC_SIGNATURE: "1",
					BUILD_VERSION: "0.5.59",
				};
				execFileSync(
					"bash",
					["-e", "-c", jobs.build.steps.find((step) => step.name === "Archive build checkpoint").run],
					{ cwd: root, env },
				);
				mkdirSync(join(runnerTemp, "release-checkpoint"));
				writeFileSync(
					join(runnerTemp, "release-checkpoint/release-build.tar"),
					readFileSync(join(runnerTemp, "release-build.tar")),
				);
				// Verification can mutate the unpacked executable; retries must start from the saved build.
				writeFileSync(join(release, "Vetta"), "mutated during failed test");
				const restore = jobs.verify.steps.find((step) => step.name === "Restore build checkpoint").run;
				for (let attempt = 0; attempt < 2; attempt += 1) {
					execFileSync("bash", ["-e", "-c", restore], { cwd: root, env });
					expect(readFileSync(join(release, "Vetta"), "utf8")).toBe("signed executable fixture");
					expect(readFileSync(join(release, "installer.exe.files.json"), "utf8")).toBe("verification manifest");
					expect(JSON.parse(readFileSync(join(desktop, "package.json"), "utf8")).version).toBe("0.5.59");
					if (process.platform !== "win32") {
						expect(statSync(join(release, "Vetta")).mode & 0o777).toBe(0o755);
						expect(readlinkSync(join(release, "bundle-link"))).toBe("Vetta");
					}
				}
				expect(readFileSync(envFile, "utf8")).toContain("VETTA_REQUIRE_MAC_SIGNATURE=1");
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);

	it("prewarms tag-readable downloads on the default branch without building or publishing", () => {
		const warm = parse(readFileSync(join(import.meta.dirname, "../../.github/workflows/desktop-cache.yml"), "utf8"));
		expect(warm.on.schedule).toHaveLength(1);
		expect(warm.jobs.warm.if).toContain("github.event.repository.default_branch");
		expect([...warm.jobs.warm.strategy.matrix.runner].sort()).toEqual(
			jobs.build.strategy.matrix.include.map((entry) => entry.runner).sort(),
		);
		expect(warm.jobs.warm.steps.some((step) => /dist:|publish:/.test(step.run ?? ""))).toBe(false);
	});

	it("runs quality and packaging tests before the platform matrix", () => {
		expect(workflow).toContain("  quality:");
		expect(workflow).toContain("run: bun run check");
		expect(workflow).toContain("run: bun run test:quality");
		expect(workflow).toContain("run: bun run verify:desktop:contracts");
		expect(workflow).toContain("run: bun run test:desktop:packaging");
		expect(workflow).toContain("needs: [prepare, quality]");
	});

	it("verifies the public update feed after either publish target", () => {
		expect(workflow.match(/node scripts\/verify-update-feed\.mjs/g)).toHaveLength(2);
		// 两个 publish job 都排在 release-gate 之后：由 gate 决定本次真正产出的平台清单。
		expect(workflow.match(/needs: \[prepare, quality, release-gate\]/g)).toHaveLength(2);
		expect(
			workflow.match(/VETTA_UPDATE_FEED_PLATFORMS: \$\{\{ needs\.release-gate\.outputs\.built-platforms \}\}/g),
		).toHaveLength(2);
	});

	// mac 是尽力而为平台：没有 Apple 凭据时它的失败不该作废整轮发布，但 windows / linux
	// 的缺失必须仍然拦住 publish。
	it("keeps macOS best-effort without letting a missing Windows or Linux build publish", () => {
		expect(workflow).toContain("continue-on-error: $" + "{{ matrix.bestEffort == true }}");
		// 只有两条 mac matrix 条目带 bestEffort，windows / linux 不带。
		expect(workflow.match(/bestEffort: true/g)).toHaveLength(2);

		const gateJob = workflow.slice(workflow.indexOf("\n  release-gate:"), workflow.indexOf("\n  publish-r2:"));
		expect(workflow).toContain("\n  release-gate:");
		expect(gateJob).toContain("if: always()");
		expect(gateJob).toContain("built-platforms: $" + "{{ steps.platforms.outputs.built-platforms }}");
		expect(gateJob).toContain("name: desktop-windows");
		expect(gateJob).toContain("name: desktop-linux");
		expect(gateJob).toContain("if-no-files-found: error");
		expect(gateJob).toContain("name: desktop-macos-arm64");
		expect(gateJob).toContain("name: desktop-macos-x64");
		expect(gateJob).toContain("if-no-files-found: ignore");
		expect(gateJob).toContain("release/windows/latest.yml");
		expect(gateJob).toContain("release/linux/latest-linux.yml");
		expect(gateJob).toContain("release/macos-*/latest-mac-*.yml");
		expect(gateJob).toContain("Required release platforms produced no updater metadata");
	});

	// 缺凭据不再让 tag 构建整轮失败；维护者配好真证书后可以用仓库变量重新收紧。
	it("lets maintainers re-tighten macOS signing through a repository variable", () => {
		expect(workflow).toContain("REQUIRE_RELEASE_SIGNATURE: $" + "{{ vars.MACOS_REQUIRE_SIGNATURE }}");
		expect(workflow).not.toContain("REQUIRE_RELEASE_SIGNATURE: $" + "{{ needs.prepare.outputs.should-publish");
		expect(workflow).toContain("the macOS artifacts are ad-hoc signed");
		expect(workflow).toContain("GITHUB_STEP_SUMMARY");
	});

	it("runs packaged boot and updater E2E on every release platform", () => {
		expect(workflow).toContain("Run packaged app and updater E2E");
		expect(workflow).toContain('VETTA_E2E_UPDATE_FEED: "1"');
		expect(workflow).toContain("xvfb-run --auto-servernum bun run test:e2e:packaged");
		const initialVerify = workflow.indexOf("- name: Verify platform updater artifacts");
		const packagedE2e = workflow.indexOf("- name: Run packaged app and updater E2E");
		const finalVerify = workflow.indexOf("- name: Re-verify platform updater artifacts after packaged E2E");
		const upload = workflow.indexOf("- name: Upload updater artifacts");
		expect(initialVerify).toBeLessThan(packagedE2e);
		expect(packagedE2e).toBeLessThan(finalVerify);
		expect(finalVerify).toBeLessThan(upload);
	});

	it("keeps the pull-request packaged E2E matrix cross-platform", () => {
		expect(packagedWorkflow).toContain("runner: windows-latest");
		expect(packagedWorkflow).toContain("runner: macos-latest");
		expect(packagedWorkflow).toContain("runner: ubuntu-latest");
		expect(packagedWorkflow).toContain("bun run test:e2e:packaged");
		expect(packagedWorkflow).toContain("xvfb-run --auto-servernum");
	});

	it("installs Linux bubblewrap build dependencies in packaged and release builds", () => {
		for (const workflowSource of [packagedWorkflow, workflow]) {
			expect(workflowSource).toContain("Install Linux packaging dependencies");
			expect(workflowSource).toContain("if: runner.os == 'Linux'");
			expect(workflowSource).toContain("build-essential libcap-dev meson ninja-build pkg-config xz-utils");
		}
	});

	it("builds, verifies, installs, and uploads all Linux release formats", () => {
		expect(workflow).toContain("command: dist:linux");
		expect(workflow).toContain("verify: verify:updates:linux:release");
		expect(workflow).toContain("pkg-config xz-utils rpm");
		expect(workflow).toContain("Verify native Linux package installation");
		expect(workflow).toContain("ubuntu:24.04");
		expect(workflow).toContain("fedora:latest");
		expect(workflow).toContain("dnf install --assumeyes --nogpgcheck");
		expect(workflow).toContain(`test -x "\${app_dir}/Metoai"`);
		expect(workflow).toContain(`test "$(cat "\${app_dir}/resources/package-type")" = "deb"`);
		expect(workflow).toContain(`test "$(cat "\${app_dir}/resources/package-type")" = "rpm"`);
		expect(workflow).toContain("apps/desktop/release/*.AppImage");
		expect(workflow).toContain("apps/desktop/release/*.deb");
		expect(workflow).toContain("apps/desktop/release/*.rpm");
	});

	it("keeps the Linux container probes quoting-safe and self-reporting", () => {
		const containerScripts = dockerContainerScripts(workflow).filter((script) =>
			/(apt-get install|dnf install) /.test(script),
		);
		expect(containerScripts).toHaveLength(2);
		for (const script of containerScripts) {
			// 脚本体由外层单引号包裹，内部再出现单引号会提前闭合它并让外层 shell 吃掉
			// 反斜杠（`-printf '%h\n'` 实际变成 `-printf %hn`），探测会静默失败。
			expect(script).not.toContain("'");
			expect(script).toContain("find /opt -mindepth 2 -maxdepth 2 -type f -name Metoai -print -quit");
			expect(script).toContain(`test -n "\${binary}" || { echo "no Metoai executable installed under /opt"`);
			expect(script).toContain('|| { echo "no desktop entry installed"');
		}
	});

	it("keeps pull-request Linux packaging on the AppImage smoke target", () => {
		expect(packagedWorkflow).toContain("command: dist:linux:test");
		const desktopPackage = JSON.parse(
			readFileSync(join(import.meta.dirname, "../../apps/desktop/package.json"), "utf8"),
		);
		expect(desktopPackage.scripts["dist:linux:test"]).toContain("dist:linux:appimage");
	});

	it("builds, verifies, and uploads all Windows release formats", () => {
		expect(workflow).toContain("command: dist:win");
		expect(workflow).toContain("verify: verify:updates:windows");
		expect(workflow).toContain("Verify supplemental Windows packages");
		expect(workflow).toContain("run: bun run verify:packages:windows");
		expect(workflow).toContain("apps/desktop/release/*.exe");
		expect(workflow).toContain("apps/desktop/release/*.msi");
		expect(workflow).toContain("apps/desktop/release/*.zip");

		const desktopPackage = JSON.parse(
			readFileSync(join(import.meta.dirname, "../../apps/desktop/package.json"), "utf8"),
		);
		expect(desktopPackage.scripts["dist:win"]).toBe("bun run package:win");
		expect(desktopPackage.scripts["package:win"]).toMatch(/--platform win$/);
	});

	it("keeps pull-request Windows packaging on the unpacked smoke target", () => {
		expect(packagedWorkflow).toContain("build-command: pack:win:test");
		const desktopPackage = JSON.parse(
			readFileSync(join(import.meta.dirname, "../../apps/desktop/package.json"), "utf8"),
		);
		expect(desktopPackage.scripts["pack:win:test"]).toContain("pack:win");
	});

	it("installs the Electron audio runtime required by Ubuntu 24.04", () => {
		const packagedSmokeJob = packagedWorkflow.split("\n  smoke:\n")[1];
		const releaseBuildJob = workflow.split("\n  build:\n")[1]?.split("\n  publish-github:\n")[0];
		for (const jobSource of [packagedSmokeJob, releaseBuildJob]) {
			expect(jobSource).toBeDefined();
			expect(jobSource).toContain("Install Linux Electron runtime dependencies");
			expect(jobSource).toContain("libasound2t64");
		}
	});

	it("installs the IM gateway Go toolchain from its module declaration", () => {
		const packagedSmokeJob = packagedWorkflow.split("\n  smoke:\n")[1];
		const releaseBuildJob = workflow.split("\n  build:\n")[1]?.split("\n  publish-github:\n")[0];
		for (const jobSource of [packagedSmokeJob, releaseBuildJob]) {
			expect(jobSource).toBeDefined();
			expect(jobSource).toContain("Set up Go for IM gateway");
			expect(jobSource).toContain("uses: actions/setup-go@v5");
			expect(jobSource).toContain("go-version-file: apps/im-gateway/go.mod");
			expect(jobSource).toContain("cache-dependency-path: apps/im-gateway/go.sum");
		}
	});

	it("uses the same publish jobs for tagged stable and dispatched test/stable releases", () => {
		expect(workflow).toContain("build_version:");
		expect(workflow).toContain("should-publish: $" + "{{ steps.config.outputs.should_publish }}");
		expect(workflow).toContain("needs.prepare.outputs.should-publish == 'true'");
		expect(workflow).toContain("'desktop-test'");
		expect(workflow).toContain("environment: $" + "{{");
		expect(workflow).toContain("'desktop-production' }}");
		expect(workflow).toContain("OUTPUT_BUILD_VERSION");
		expect(workflow).toContain("REQUIRE_RELEASE_SIGNATURE");
		expect(workflow).toContain("needs.prepare.outputs.should-publish == 'true'");
		expect(workflow).toContain('--target "' + "$" + '{GITHUB_SHA}"');
	});

	// im-gateway 的 sidecar 由 prepare-pack.js 交叉编译进发布包，但它的 Go 测试
	// 既不在 `bun run check` 里，im-gateway.yml 也不 gate 本流水线。少了这道门禁，
	// 测试失败的 sidecar 会被静默打包发布。
	it("gates the release on the IM gateway Go tests", () => {
		const qualityJob = workflow.slice(workflow.indexOf("\n  quality:"), workflow.indexOf("\n  build:"));
		expect(qualityJob).toContain("go test ./...");
		expect(qualityJob).toContain("working-directory: apps/im-gateway");
		expect(qualityJob).toContain("go-version-file: apps/im-gateway/go.mod");
	});

	it("builds each macOS architecture on a matching hosted runner", () => {
		expect(workflow).toContain("runs-on: $" + "{{ matrix.runner }}");
		expect(workflow).toContain("runner: macos-15\n");
		expect(workflow).toContain("runner: macos-15-intel\n");
		expect(workflow).not.toContain("vetta-mac");
	});

	it("allows enough wall clock for signing and notarizing both macOS architectures", () => {
		const buildJob = workflow.slice(workflow.indexOf("\n  build:"), workflow.indexOf("\n  publish-r2:"));
		const timeout = Number(buildJob.match(/timeout-minutes: (\d+)/)?.[1]);
		expect(timeout).toBeGreaterThanOrEqual(120);
	});

	// R2 是更新源，GitHub Release 是对外的下载入口和版本说明归档。早先两个发布 job
	// 按 release_target 互斥，商业版发版在 GitHub 上什么都看不到。
	it("publishes a GitHub Release alongside R2 for every non-test channel", () => {
		expect(workflow).toContain("  publish-github:");
		expect(workflow).toContain("needs.prepare.outputs.channel != 'test'");
		expect(workflow).not.toContain("needs.prepare.outputs.release_target != 'r2'");
	});

	it("uses the versioned release note as the GitHub Release body", () => {
		expect(workflow).toContain("node scripts/release/release-notes.mjs --check");
		expect(workflow).toContain('--notes-file "' + "$" + '{NOTES_FILE}"');
		expect(workflow).not.toContain("--generate-notes");
		// 正文缺失要在质量阶段就失败，而不是等平台矩阵签名公证跑完。
		const qualityJob = workflow.slice(workflow.indexOf("\n  quality:"), workflow.indexOf("\n  build:"));
		expect(qualityJob).toContain("node scripts/release/release-notes.mjs --check");
	});

	it("provides an isolated test-channel workflow for real install and restart upgrades", () => {
		expect(upgradeWorkflow).toContain("baseline_version:");
		expect(upgradeWorkflow).toContain("candidate_version:");
		expect(upgradeWorkflow).toContain("environment: desktop-test");
		expect(upgradeWorkflow).toContain("bun run test:e2e:upgrade");
		expect(upgradeWorkflow).toContain("xvfb-run --auto-servernum");
		expect(upgradeWorkflow).toContain("upgrade-e2e-diagnostics");
	});
});
