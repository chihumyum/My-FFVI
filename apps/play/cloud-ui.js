import { translateDOM } from "./language.js";
import { tr, i18n, dateLocale } from "../../src/play/i18n.js";
import "./cloud-ui.css";
import { rememberIdentity } from "./identity.js";

function element(tag, text, parent) {
  const value = document.createElement(tag);
  if (text?.i18n) {
    value.dataset.i18n = text.i18n;
    value.textContent = tr(text.i18n);
  } else if (text) value.textContent = text;
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
  const toggle = element("button", { i18n: "cloud_ui.cloud_saves" }, root);
  toggle.type = "button";
  toggle.id = "cloud-toggle";
  const reserveToolbarSpace = () =>
    document.body.style.setProperty(
      "--cloud-controls-width",
      `${Math.ceil(toggle.getBoundingClientRect().right + 16)}px`,
    );
  const toolbarObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reserveToolbarSpace);
  toolbarObserver?.observe(toggle);
  const dialog = element("dialog", null, root);
  dialog.id = "cloud-panel";
  dialog.setAttribute("aria-labelledby", "cloud-heading");
  element("h2", { i18n: "cloud_ui.saves_and_sync" }, dialog).id = "cloud-heading";
  const state = element("p", null, dialog);
  state.role = "status";
  state.setAttribute("aria-live", "polite");
  element(
    "p",
    { i18n: "cloud_ui.save_locally_then_sync_sync_does_not_change_the_current" },
    dialog,
  );
  const tools = element("div", null, dialog);
  tools.className = "cloud-actions";
  const status = element("p", null, dialog);
  status.role = "status";
  const run = async (action) => {
    status.textContent = tr("cloud_ui.working");
    try {
      await action();
      status.textContent = tr("cloud_ui.done");
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
    if (document.querySelector('meta[name="ffvi-identity"]')) {
      const identity = element("section", null, dialog);
      dialog.insertBefore(identity, tools);
      identity.className = "cloud-identity";
      element("h3", { i18n: "cloud_ui.isolated_save_identity" }, identity);
      const label = element("p", null, identity);
      const updateLabel = () => {
        const value = library.cloud.identity;
        label.textContent = value?.legacy
          ? tr("cloud_ui.current_original_private_saves_access_requires_the_orig")
          : tr("cloud_ui.save_id_value_back_up_your_identity_and_import_the_same", {
              v0: value?.profileId || tr("cloud_ui.connecting"),
            });
      };
      updateLabel();
      library.subscribe(updateLabel);
      button(
        { i18n: "cloud_ui.back_up_recovery_key" },
        () => {
          const current = library.cloud.identity;
          const key = localStorage.getItem(`ffvi-recovery:${current?.serverId}`);
          if (!key)
            throw Error(tr("cloud_ui.no_recovery_key_is_saved_locally_for_this_identity_use_"));
          download(
            {
              format: "ffvi-reweb-identity",
              version: 1,
              site: location.origin,
              profileId: current.profileId,
              recoveryKey: key,
            },
            "ffvi-identity-keep-private.json",
          );
          localStorage.setItem(`ffvi-recovery-backed:${current.serverId}`, "1");
        },
        identity,
      );
      const restore = element("input", null, identity);
      restore.type = "password";
      restore.placeholder = tr("cloud_ui.paste_the_complete_recovery_key_ffvi");
      restore.autocomplete = "off";
      restore.setAttribute("aria-label", tr("cloud_ui.recovery_key"));
      const switchTo = (value, key) => {
        rememberIdentity(value, key, { activate: false });
        location.reload();
      };
      button(
        { i18n: "cloud_ui.restore_existing_identity" },
        async () => {
          const key = restore.value.trim();
          const value = await library.cloud.recover(key);
          switchTo(value, key);
        },
        identity,
      );
      const recoveryFile = element("input", null, identity);
      recoveryFile.type = "file";
      recoveryFile.accept = "application/json,.json";
      recoveryFile.hidden = true;
      button({ i18n: "cloud_ui.import_identity_backup" }, () => recoveryFile.click(), identity);
      recoveryFile.onchange = () =>
        run(async () => {
          const file = recoveryFile.files[0];
          if (!file || file.size > 4096)
            throw Error(tr("cloud_ui.choose_a_valid_identity_backup_file"));
          const value = JSON.parse(await file.text());
          if (
            value.format !== "ffvi-reweb-identity" ||
            value.version !== 1 ||
            typeof value.recoveryKey !== "string"
          )
            throw Error(tr("cloud_ui.this_is_not_an_identity_backup"));
          const result = await library.cloud.recover(value.recoveryKey);
          switchTo(result, value.recoveryKey);
        });
      button(
        { i18n: "cloud_ui.create_new_identity" },
        async () => {
          if (!confirm(tr("cloud_ui.switch_to_empty_saves_local_saves_for_the_old_identity_")))
            return;
          const value = await library.cloud.createIdentity();
          switchTo(value, value.recoveryKey);
        },
        identity,
      );
      element(
        "p",
        { i18n: "cloud_ui.changing_identity_reloads_the_game_save_your_progress_f" },
        identity,
      );
    }
    button({ i18n: "cloud_ui.sync_now" }, () => library.sync());
    button({ i18n: "cloud_ui.log_in_again" }, () => {
      location.assign("/login");
    });
    button({ i18n: "cloud_ui.log_out" }, async () => {
      await library.cloud.logout();
      localStorage.removeItem("ffvi-recovery-active");
      location.assign("/login");
    });
  }
  button({ i18n: "cloud_ui.export_all_local_saves" }, async () =>
    download(await library.export(), `ffvi-saves-${new Date().toISOString().slice(0, 10)}.json`),
  );
  if (navigator.storage?.persist)
    button({ i18n: "cloud_ui.keep_local_saves" }, async () => {
      const granted = await navigator.storage.persist();
      if (!granted)
        throw Error(tr("cloud_ui.persistent_storage_was_not_granted_local_saves_still_wo"));
    });
  const input = element("input", null, dialog);
  input.type = "file";
  input.accept = "application/json,.json";
  input.hidden = true;
  button({ i18n: "cloud_ui.import_save_backup" }, () => {
    input.click();
  });
  input.onchange = () =>
    run(async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 100 * 1024 * 1024)
        throw Error(tr("cloud_ui.backup_too_large_100_mb_maximum"));
      const backup = JSON.parse(await file.text());
      if (confirm(tr("cloud_ui.import_replaces_matching_local_slots_existing_versions_"))) {
        const count = await library.import(backup);
        status.textContent = tr("cloud_ui.imported_value_slots", { v0: count });
      }
      input.value = "";
    });
  const conflicts = element("div", null, dialog),
    versions = element("div", null, dialog),
    archives = element("div", null, dialog);
  let historySelect;
  if (library.cloud.enabled) {
    element(
      "h3",
      { i18n: "cloud_ui.cloud_history_up_to_50_versions_per_slot_48_mib_per_ano" },
      versions,
    );
    historySelect = element("select", null, versions);
    historySelect.setAttribute("aria-label", tr("cloud_ui.history_slot"));
    const list = element("div", null, versions);
    historySelect.onchange = () => list.replaceChildren();
    button(
      { i18n: "cloud_ui.view_history" },
      async () => {
        const id = historySelect.value;
        if (!id) return;
        list.replaceChildren();
        for (const row of await library.cloud.history(id)) {
          button(
            tr("cloud_ui.restore_version_value_value", {
              v0: row.revision,
              v1: new Date(row.updatedAt).toLocaleString(dateLocale()),
            }),
            async () => {
              if (confirm(tr("cloud_ui.restore_this_version_locally_and_sync_the_current_local")))
                await library.restore(id, row.revision);
            },
            list,
          );
        }
      },
      versions,
    );
  }
  const close = button({ i18n: "cloud_ui.return_to_game" }, () => dialog.close(), dialog);
  close.className = "cloud-close";
  const updateStatus = (value) => {
    state.textContent = value.message;
    const current = library.cloud.identity;
    const needsBackup =
      current &&
      !current.legacy &&
      !localStorage.getItem(`ffvi-recovery-backed:${current.serverId}`);
    toggle.textContent =
      value.state === "conflict"
        ? tr("cloud_ui.save_conflict")
        : needsBackup
          ? tr("cloud_ui.cloud_saves_back_up_identity")
          : tr("cloud_ui.cloud_saves");
    toggle.dataset.state = value.state;
    if (dialog.open) refresh();
  };
  const unsubscribe = library.subscribe(updateStatus);
  const translate = () => {
    translateDOM(root);
    updateStatus(library.status);
    reserveToolbarSpace();
  };
  i18n.on("languageChanged", translate);
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
        `${record.mode === "normal" ? tr("cloud_ui.normal") : tr("cloud_ui.boosted")} · ${record.slot === "auto" ? tr("cloud_ui.autosave") : tr("cloud_ui.slot_value", { v0: record.slot })}`,
        card,
      );
      element(
        "p",
        tr("cloud_ui.local_value_value_ncloud_value_version_value", {
          v0: record.map,
          v1: new Date(record.savedAt).toLocaleString(dateLocale()),
          v2: remote.record?.map || tr("cloud_ui.this_slot_no_longer_exists"),
          v3: remote.revision,
        }),
        card,
      );
      if (remote.record)
        button(
          { i18n: "cloud_ui.use_cloud_local_version_backed_up" },
          () => library.resolve(record.id, "cloud"),
          card,
        );
      button(
        { i18n: "cloud_ui.use_local_overwrite_cloud_old_version_kept_in_history" },
        async () => {
          if (confirm(tr("cloud_ui.overwrite_this_cloud_slot_with_local_progress_the_old_c")))
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
      element(
        "summary",
        tr("cloud_ui.local_retained_versions_value", { v0: history.length }),
        details,
      );
      for (const row of history)
        button(
          tr("cloud_ui.download_value_value_value", {
            v0: row.sourceId,
            v1: row.map,
            v2: new Date(row.savedAt).toLocaleString(dateLocale()),
          }),
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
    toolbarObserver?.disconnect();
    i18n.off("languageChanged", translate);
    clearInterval(interval);
    root.remove();
  };
}
