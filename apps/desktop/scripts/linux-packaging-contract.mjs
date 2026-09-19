export const LINUX_RELEASE_TARGETS = Object.freeze(["AppImage", "deb", "rpm"]);

export const LINUX_RELEASE_EXTENSIONS = Object.freeze([".AppImage", ".deb", ".rpm"]);

// electron-builder 把 deb/rpm 的载荷装到这里（app-builder-lib targets/LinuxTargetHelper.js
// 的 installPrefix）。
export const LINUX_INSTALL_PREFIX = "/opt";

export const LINUX_PACKAGE_METADATA = Object.freeze({
	author: Object.freeze({
		name: "OpenVetta",
		email: "openvetta@users.noreply.github.com",
	}),
	homepage: "https://github.com/openvetta/open-vetta",
	license: "Apache-2.0",
	maintainer: "OpenVetta <openvetta@users.noreply.github.com>",
	vendor: "OpenVetta",
});

/**
 * deb/rpm 载荷路径的推导规则，与 electron-builder 保持一致：
 * 安装目录是 `${installPrefix}/${sanitizedProductName}`（FpmTarget），可执行文件名是
 * `linux.executableName ?? executableName`（linuxPackager）。校验脚本必须按同一份构建
 * 配置推导，写死品牌名会在产品名变化后指向一个不存在的路径。
 */
export function resolveLinuxPayloadPaths({ productName, executableName, linuxExecutableName } = {}) {
	const appDir = requirePackagePathSegment(productName, "productName");
	const binary = requirePackagePathSegment(linuxExecutableName ?? executableName, "executableName");
	return Object.freeze([
		`${LINUX_INSTALL_PREFIX}/${appDir}/${binary}`,
		`${LINUX_INSTALL_PREFIX}/${appDir}/resources/package-type`,
	]);
}

// electron-builder 会对产品名和可执行文件名做 sanitize；这里只接受无需改写的名字，
// 避免校验侧和构建侧各推出一套路径。
function requirePackagePathSegment(value, label) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`[linux-packaging-contract] missing ${label} for the Linux package layout`);
	}
	const name = value.trim();
	if (!/^[A-Za-z0-9._-]+$/.test(name)) {
		throw new Error(
			`[linux-packaging-contract] ${label} ${name} is not a plain path segment; the Linux package layout cannot be derived from it`,
		);
	}
	return name;
}
