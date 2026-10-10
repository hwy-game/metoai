import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 气泡样式是 JSON 里的 class 字面量（apps/desktop/src/shared/pet-bubble-styles/*.json），
 * 而 Tailwind 只生成**它扫得到的字面量**。该目录在 renderer 根目录之外，所以必须在
 * renderer/styles.css 里显式 `@source` 放行——否则气泡的背景板与边框没有规则，透明桌宠窗
 * 上只剩继承来的文字色，浅色主题下就是「黑底黑字」。
 *
 * 这个守卫把「样式声明了背景板」和「宿主会生成规则」绑在一起：以后新增气泡样式目录或
 * 搬动 styles.css 时，忘了放行会在这里失败，而不是等到有人截图才发现。
 */

const rendererDir = resolve(import.meta.dirname, "../../..");
const bubbleStylesDir = resolve(rendererDir, "../shared/pet-bubble-styles");
const stylesPath = join(rendererDir, "styles.css");

/** styles.css 里所有按路径放行的 `@source`（`@source inline(...)` 是逐条白名单，不算）。 */
function sourceDirectories(): string[] {
	const styles = readFileSync(stylesPath, "utf8");
	return [...styles.matchAll(/@source\s+"([^"]+)"/g)]
		.map((match) => match[1])
		.filter((pattern) => !pattern.startsWith("inline("))
		.map((pattern) => resolve(rendererDir, pattern));
}

describe("桌宠气泡样式的 Tailwind 扫描范围", () => {
	it("放行了气泡样式目录", () => {
		expect(sourceDirectories()).toContain(bubbleStylesDir);
	});

	it("气泡样式确实带着背景板 class，上面的断言不会空转", () => {
		const classNames = readdirSync(bubbleStylesDir)
			.filter((name) => name.endsWith(".json"))
			.flatMap((name) => {
				const parsed = JSON.parse(readFileSync(join(bubbleStylesDir, name), "utf8")) as {
					surface?: { bodyClassName?: string };
				};
				return (parsed.surface?.bodyClassName ?? "").split(/\s+/);
			});

		expect(classNames.some((className) => className.startsWith("bg-"))).toBe(true);
	});
});
