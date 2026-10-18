import { openStore } from "./store.mjs";
import { createHost } from "./host.mjs";
import path from "node:path";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: "string", default: process.env.FFVI_DATA || "private-data" },
    static: { type: "string", default: process.env.FFVI_STATIC || "dist/web" },
    host: { type: "string", default: process.env.FFVI_BIND || "127.0.0.1" },
    port: { type: "string", default: process.env.PORT || "4180" },
    public: { type: "string", default: process.env.FFVI_PUBLIC_URL },
    output: { type: "string" },
  },
});
const store = await openStore(path.resolve(values.data), {
  password: process.env.FFVI_INITIAL_PASSWORD,
});
const command = positionals[0] || "serve";
if (command === "backup") {
  const output = path.resolve(
    values.output || `backups/ffvi-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
  );
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await store.backup(output);
  store.close();
  console.log(`完整存档历史备份：${output}`);
} else if (command === "password") {
  const password = process.env.FFVI_NEW_PASSWORD;
  if (!password)
    throw Error("请通过 FFVI_NEW_PASSWORD 环境变量提供新密码（至少 12 字符）；旧会话将退出");
  await store.password(password);
  store.close();
  console.log("密码已更新，所有旧登录会话已失效。");
} else if (command === "serve") {
  const server = await createHost({
    store,
    staticDir: path.resolve(values.static),
    publicURL: values.public,
  });
  server.listen(Number(values.port), values.host, () => {
    console.log(`FFVI 私人站点：http://${values.host}:${server.address().port}/`);
    console.log(`私有数据目录：${path.resolve(values.data)}（首次生成密码保存在 first-login.txt）`);
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () =>
      server.close(() => {
        store.close();
        process.exit(0);
      }),
    );
} else {
  store.close();
  throw Error(`未知命令：${command}`);
}
