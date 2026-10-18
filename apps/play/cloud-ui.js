import "./cloud-ui.css";

function element(tag, text, parent) {
  const value = document.createElement(tag);
  if (text) value.textContent = text;
  parent?.append(value);
  return value;
}
function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: "application/json" }));
  const link = element("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function mountCloudUI(library, { onOpen, onClose } = {}) {
  if (library.cloud.enabled) {
    const manifest = element("link", null, document.head);
    manifest.rel = "manifest";
    manifest.href = "/manifest.webmanifest";
    const theme = element("meta", null, document.head);
    theme.name = "theme-color";
    theme.content = "#101a2e";
    const standalone = element("meta", null, document.head);
    standalone.name = "apple-mobile-web-app-capable";
    standalone.content = "yes";
  }
  const root = element("div", null, document.body);
  root.className = "cloud-controls";
  const toggle = element("button", "云存档", root);
  toggle.type = "button";
  toggle.id = "cloud-toggle";
  const dialog = element("dialog", null, root);
  dialog.id = "cloud-panel";
  dialog.setAttribute("aria-labelledby", "cloud-heading");
  element("h2", "存档与同步", dialog).id = "cloud-heading";
  const state = element("p", null, dialog);
  state.role = "status";
  state.setAttribute("aria-live", "polite");
  element(
    "p",
    "先存本机，再同步云端。同步不会切换正在玩的进度；在另一台设备上请从标题读档继续。普通和强化存档分开。",
    dialog,
  );
  const tools = element("div", null, dialog);
  tools.className = "cloud-actions";
  const status = element("p", null, dialog);
  status.role = "status";
  const run = async (action) => {
    status.textContent = "正在处理…";
    try {
      await action();
      status.textContent = "已完成";
      await refresh();
    } catch (error) {
      status.textContent = error.message;
    }
  };
  const button = (label, action, parent = tools) => {
    const value = element("button", label, parent);
    value.type = "button";
    value.onclick = () => run(action);
    return value;
  };
  if (library.cloud.enabled) {
    button("立即同步", () => library.sync());
    button("重新登录", () => {
      location.assign("/login");
    });
    button("退出登录", async () => {
      await library.cloud.logout();
      location.assign("/login");
    });
  }
  button("导出本机全部存档", async () =>
    download(await library.export(), `ffvi-saves-${new Date().toISOString().slice(0, 10)}.json`),
  );
  if (navigator.storage?.persist)
    button("保留本机存档", async () => {
      const granted = await navigator.storage.persist();
      if (!granted) throw Error("浏览器未授予永久存储；本机存档仍可用，建议同时导出备份");
    });
  const input = element("input", null, dialog);
  input.type = "file";
  input.accept = "application/json,.json";
  input.hidden = true;
  button("导入存档备份", () => {
    input.click();
  });
  input.onchange = () =>
    run(async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 100 * 1024 * 1024) throw Error("备份过大（最多 100 MB）");
      const backup = JSON.parse(await file.text());
      if (confirm("导入会替换同名的本机存档槽；现有版本会先保留在本机备份中。继续吗？")) {
        const count = await library.import(backup);
        status.textContent = `已导入 ${count} 槽`;
      }
      input.value = "";
    });
  const conflicts = element("div", null, dialog),
    versions = element("div", null, dialog),
    archives = element("div", null, dialog);
  let historySelect;
  if (library.cloud.enabled) {
    element("h3", "云端历史 · 每槽最近 50 版", versions);
    historySelect = element("select", null, versions);
    historySelect.setAttribute("aria-label", "历史存档槽");
    const list = element("div", null, versions);
    historySelect.onchange = () => list.replaceChildren();
    button(
      "查看历史",
      async () => {
        const id = historySelect.value;
        if (!id) return;
        list.replaceChildren();
        for (const row of await library.cloud.history(id)) {
          button(
            `恢复版本 ${row.revision} · ${new Date(row.updatedAt).toLocaleString()}`,
            async () => {
              if (confirm("将此历史进度写回本机并同步？当前本机版本会保留在备份中。"))
                await library.restore(id, row.revision);
            },
            list,
          );
        }
      },
      versions,
    );
  }
  const close = button("返回游戏", () => dialog.close(), dialog);
  close.className = "cloud-close";
  const unsubscribe = library.subscribe((value) => {
    state.textContent = value.message;
    toggle.textContent = value.state === "conflict" ? "存档冲突" : "云存档";
    toggle.dataset.state = value.state;
    if (dialog.open) refresh();
  });
  async function refresh() {
    const records = await library.all();
    conflicts.replaceChildren();
    for (const record of records.filter((row) => row.sync?.conflict && !row.archivedAt)) {
      const card = element("section", null, conflicts);
      card.className = "cloud-conflict";
      card.dataset.slot = record.id;
      const remote = record.sync.conflict;
      element(
        "h3",
        `${record.mode === "normal" ? "普通" : "强化"} · ${record.slot === "auto" ? "自动存档" : `存档 ${record.slot}`}`,
        card,
      );
      element(
        "p",
        `本机：${record.map} · ${new Date(record.savedAt).toLocaleString()}\n云端：${remote.record?.map || "此槽已不存在"} · 版本 ${remote.revision}`,
        card,
      );
      if (remote.record)
        button("采用云端（本机版本保留在备份）", () => library.resolve(record.id, "cloud"), card);
      button(
        "采用本机（覆盖云端，旧版保留历史）",
        async () => {
          if (confirm("确定用本机进度覆盖此云端存档槽？旧云端版本仍保留在历史记录中。"))
            await library.resolve(record.id, "local");
        },
        card,
      );
    }
    if (historySelect) {
      const selected = historySelect.value;
      historySelect.replaceChildren();
      for (const record of records.filter((row) => !row.archivedAt)) {
        const option = element(
          "option",
          `${record.mode} · ${record.slot} · ${record.map}`,
          historySelect,
        );
        option.value = record.id;
      }
      if ([...historySelect.options].some((option) => option.value === selected))
        historySelect.value = selected;
    }
    archives.replaceChildren();
    const history = records
      .filter((row) => row.archivedAt)
      .sort((a, b) => b.archivedAt - a.archivedAt);
    if (history.length) {
      const details = element("details", null, archives);
      element("summary", `本机保留版本（${history.length}）`, details);
      for (const row of history)
        button(
          `下载 ${row.sourceId} · ${row.map} · ${new Date(row.savedAt).toLocaleString()}`,
          () =>
            download(
              { format: "ffvi-reweb-saves", version: 1, records: [{ ...row, id: row.sourceId }] },
              `ffvi-recovered-${row.sourceId.replace(":", "-")}-${row.savedAt}.json`,
            ),
          details,
        );
    }
  }
  toggle.onclick = () => {
    onOpen?.();
    dialog.showModal();
    refresh();
  };
  dialog.addEventListener("close", () => onClose?.());
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  const synchronize = () => library.sync();
  addEventListener("online", synchronize);
  addEventListener("focus", synchronize);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) synchronize();
  });
  const interval = setInterval(synchronize, 30000);
  library.initialize().catch((error) => library.notify("offline", error.message));
  return () => {
    unsubscribe();
    clearInterval(interval);
    root.remove();
  };
}
