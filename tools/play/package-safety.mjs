export function assertPrivatePackage(files) {
  for (const { file } of files) {
    if (
      file.startsWith("/") ||
      file.split("/").includes("..") ||
      /(^|\/)(private-data|backups|bug-reports|node_modules|\.git)(\/|$)/.test(file) ||
      /(^|\/)\.env($|\.(?!example$))/.test(file) ||
      /(^|\/)(first-login\.txt|owner\.json)$/.test(file) ||
      /\.sqlite(?:-wal|-shm)?$/.test(file)
    )
      throw Error(`拒绝打包私人数据或凭据：${file}`);
  }
}
