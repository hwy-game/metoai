export const WINDOWS_RELEASE_TARGETS = Object.freeze(["inno", "msi", "zip"]);

export const WINDOWS_SUPPLEMENTAL_EXTENSIONS = Object.freeze([".msi", ".zip"]);

/**
 * MSI/ZIP 是 electron-builder 生成的补充格式，产物名跟着构建配置的产品名走
 * （`${productName}-${version}-win-${arch}.<ext>`）。这里按扩展名 + 版本号在产物目录里
 * 定位，而不是拼一个写死的品牌名；R2 发布 job 只下载产物、拿不到构建配置，也只能这么找。
 */
export function findWindowsSupplementalArtifacts(fileNames, version) {
	return [...fileNames]
		.filter((fileName) => WINDOWS_SUPPLEMENTAL_EXTENSIONS.some((extension) => fileName.endsWith(extension)))
		.filter((fileName) => fileName.includes(version))
		.sort();
}
