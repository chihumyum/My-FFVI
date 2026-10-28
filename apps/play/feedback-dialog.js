import { translateDOM } from "./language.js";
import { tr } from "../../src/play/i18n.js";
import { downloadBugReport, reportValue, saveBugReport } from "./bug-report.js";
import "./feedback-dialog.css";

// The host captures the immutable game/screenshot first, and pauses until this resolves.
export function openFeedbackDialog(capturedReport, options = {}) {
  const report = reportValue(capturedReport);
  report.submissionId ||= crypto.randomUUID();
  const dialog = document.createElement("dialog");
  dialog.className = "feedback-dialog";
  dialog.setAttribute("aria-labelledby", "feedback-title");
  const form = document.createElement("form");
  form.innerHTML = `<header><h2 id="feedback-title" data-i18n="report.title">报告问题</h2><button type="button" class="feedback-close" aria-label="关闭问题报告" data-i18n-aria-label="report.close">×</button></header>
    <p class="feedback-context"></p><img class="feedback-preview" alt="打开问题报告时自动截取的游戏画面" data-i18n-alt="report.preview">
    <label for="feedback-description" data-i18n="report.question">出了什么问题？</label>
    <textarea id="feedback-description" name="description" rows="4" maxlength="6000" required placeholder="描述看到的问题，以及你刚才做了什么…" data-i18n-placeholder="report.description"></textarea>
    <p class="feedback-privacy" data-i18n="report.privacy">截图、剧情进度和最近的游戏事件会随说明一起发送给站点维护者。恢复密钥和浏览器存储不会上传。</p>
    <p class="feedback-result" role="status" aria-live="polite"></p>
    <footer><button type="button" class="feedback-download" data-i18n="report.download">下载报告</button><button type="button" class="feedback-cancel" data-i18n="battle_menu.cancel">取消</button><button type="submit" class="feedback-send" data-i18n="report.send">发送报告</button></footer>`;
  translateDOM(form);
  dialog.append(form);
  const description = form.querySelector("textarea");
  const status = form.querySelector(".feedback-result");
  const send = form.querySelector(".feedback-send");
  const download = form.querySelector(".feedback-download");
  description.value = report.description || "";
  form.querySelector(".feedback-context").textContent = [
    report.map?.name || tr("bug_report.title_screen"),
    report.script?.lastInstruction
      ? tr("feedback_dialog.value_instruction_value", {
          v0: report.script.lastInstruction.script,
          v1: report.script.lastInstruction.index,
        })
      : report.script?.story,
  ]
    .filter(Boolean)
    .join(" · ");
  form.querySelector("img").src = report.screenshot?.dataURL || "";
  let pending = false;
  const inputReport = () => ({ ...report, description: description.value.trim() });
  return new Promise((resolve) => {
    const focus = document.activeElement;
    const finish = (result) => {
      dialog.close();
      dialog.remove();
      focus?.focus?.({ preventScroll: true });
      resolve(result);
    };
    const cancel = () => {
      if (!pending) finish({ method: "cancelled" });
    };
    form.querySelector(".feedback-close").onclick = cancel;
    form.querySelector(".feedback-cancel").onclick = cancel;
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancel();
    });
    // Report text must never turn into game inputs behind the dialog.
    for (const name of ["keydown", "keyup", "pointerdown", "pointerup"])
      dialog.addEventListener(name, (event) => event.stopPropagation());
    download.onclick = () => {
      if (!pending) finish(downloadBugReport(inputReport()));
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (pending || !form.reportValidity()) return;
      pending = true;
      send.disabled = download.disabled = description.disabled = true;
      send.textContent = tr("feedback_dialog.sending");
      status.textContent = "";
      try {
        finish(await saveBugReport(inputReport(), options));
      } catch (error) {
        status.textContent = tr(
          "feedback_dialog.value_your_description_and_screenshot_are_retained_retr",
          { v0: error.message },
        );
      } finally {
        pending = false;
        send.disabled = download.disabled = description.disabled = false;
        send.textContent = tr("feedback_dialog.retry_sending");
      }
    };
    document.body.append(dialog);
    dialog.showModal();
    const initialFocus = globalThis.matchMedia?.("(pointer: coarse)").matches
      ? form.querySelector(".feedback-close")
      : description;
    initialFocus.focus({ preventScroll: true });
    dialog.scrollTop = 0;
  });
}
