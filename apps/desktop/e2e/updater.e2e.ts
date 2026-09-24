/**
 * Packaged updater E2E against a fully test-controlled update source: `wdio.conf.ts` serves a
 * local feed and registers a policy one patch above the running version through
 * `VETTA_E2E_UPDATE_POLICY`. Version detection only trusts the server registry (docs/adr/0120),
 * so what each platform asserts below is "the feed can/cannot deliver the registered version".
 */

const packaged = process.env.VETTA_E2E_PACKAGED === "1";
const UPDATE_TIMEOUT_MS = 60_000;

async function focusMainRenderer(): Promise<void> {
	await browser.waitUntil(
		async () => {
			for (const handle of await browser.getWindowHandles()) {
				await browser.switchToWindow(handle);
				if ((await browser.getUrl()).includes("index.html")) return true;
			}
			return false;
		},
		{
			timeout: UPDATE_TIMEOUT_MS,
			timeoutMsg: "Main renderer window was not available before updater E2E",
		},
	);
}

async function waitForUpdaterPhase(
	element: WebdriverIO.Element,
	phase: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error",
): Promise<void> {
	await browser.waitUntil(async () => (await element.getAttribute("data-updater-phase")) === phase, {
		timeout: UPDATE_TIMEOUT_MS,
		timeoutMsg: `Updater UI did not reach the ${phase} phase`,
	});
}

async function activateRendererControl(element: WebdriverIO.Element): Promise<void> {
	await browser.execute((control) => control.click(), element);
}

describe("MetoAI Desktop packaged updater", () => {
	(packaged ? it : it.skip)("checks the configured update feed through the settings UI", async () => {
		await browser.waitUntil(
			async () => {
				const ready = await browser.execute(() => document.readyState);
				return ready === "complete" || ready === "interactive";
			},
			{ timeout: UPDATE_TIMEOUT_MS, timeoutMsg: "Renderer was not ready before updater E2E" },
		);

		const currentVersion = await browser.electron.execute((electron) => electron.app.getVersion());
		expect(currentVersion).toMatch(/^\d+\.\d+\.\d+$/);

		await focusMainRenderer();
		await browser.execute(() => {
			window.location.hash = "/settings/general";
		});
		const checkButton = await $('[data-testid="updater-check"]');
		await checkButton.waitForDisplayed({ timeout: UPDATE_TIMEOUT_MS });
		await activateRendererControl(checkButton);
		await waitForUpdaterPhase(checkButton, "checking");

		if (process.platform === "linux") {
			// The Linux fixture serves the registered version, so the AppImage provider really
			// downloads it and stages the replacement.
			await waitForUpdaterPhase(checkButton, "available");
			const detail = await $('[data-testid="updater-detail"]');
			await detail.waitForDisplayed({ timeout: UPDATE_TIMEOUT_MS });
			expect(await detail.getText()).toContain(currentVersion);

			const downloadButton = await $('[data-testid="updater-primary"]');
			await activateRendererControl(downloadButton);
			await waitForUpdaterPhase(checkButton, "ready");
		} else {
			// Windows/macOS only publish the running version, so the registered update has no
			// deliverable package: the check must collapse to "no update" instead of prompting
			// for a version that cannot be installed (ADR-0120 fail-open).
			await waitForUpdaterPhase(checkButton, "idle");
		}

		expect(await $("body").getText()).toContain(currentVersion);
	});
});
