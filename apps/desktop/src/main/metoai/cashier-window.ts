/**
 * 内置收银台窗口。
 *
 * epay 系网关（支付宝/微信等站点配置的支付方式）要求**带参 POST** 到网关地址，
 * 这是系统浏览器做不到的：`shell.openExternal` 只能发 GET。所以这里开一个临时
 * BrowserWindow，载入一张自动提交的表单页，把用户送进网关自己的收银台。
 *
 * 表单页写在临时文件里而不是 `data:` URL：`data:` 是不透明源，各网关的跳转与
 * cookie 行为在它下面不可预期；`file://` 是一次正常的跨源表单导航。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserWindow } from "electron";
import { getAppLogger } from "../logger.js";
import { openExternalUrl } from "../open-external.js";

const log = getAppLogger("metoai");

const CASHIER_WIDTH = 520;
const CASHIER_HEIGHT = 720;

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 站点配置的支付方式名会出现在表单里，因此只接受标量参数。 */
function toFormFields(params: Record<string, unknown>): Array<[string, string]> {
	const fields: Array<[string, string]> = [];
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		if (typeof value === "object") continue;
		fields.push([key, String(value)]);
	}
	return fields;
}

function buildFormHtml(action: string, fields: Array<[string, string]>): string {
	const inputs = fields
		.map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
		.join("");
	return [
		"<!doctype html>",
		'<meta charset="utf-8">',
		"<title>MetaToken</title>",
		'<body style="font:14px system-ui;padding:32px">',
		`<form id="f" method="post" action="${escapeHtml(action)}">${inputs}</form>`,
		"<script>document.getElementById('f').submit()</script>",
		"</body>",
	].join("");
}

/**
 * 打开收银台并提交表单。返回的 Promise 在窗口被关闭时兑现——调用方据此刷新
 * 充值记录，但**不能**把关闭当成支付成功（结果以服务端回调为准）。
 */
export function openPaymentCashier(input: { url: string; params: Record<string, unknown> }): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "vetta-metoai-cashier-"));
	const formPath = join(dir, "pay.html");
	writeFileSync(formPath, buildFormHtml(input.url, toFormFields(input.params)), "utf8");

	const window = new BrowserWindow({
		width: CASHIER_WIDTH,
		height: CASHIER_HEIGHT,
		title: "MetaToken",
		autoHideMenuBar: true,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	// 网关常在新窗口里放二次确认页；收银台窗口不承载它们，交回系统浏览器。
	window.webContents.setWindowOpenHandler(({ url }) => {
		void openExternalUrl(url).catch((error: unknown) => log.warn(`cashier popup failed: ${String(error)}`));
		return { action: "deny" };
	});

	return new Promise<void>((resolve) => {
		window.once("closed", () => {
			rmSync(dir, { recursive: true, force: true });
			resolve();
		});
		void window.loadFile(formPath).catch((error: unknown) => {
			log.warn(`cashier load failed: ${String(error)}`);
		});
	});
}
