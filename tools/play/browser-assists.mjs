// Ordinary browser UI only. Kept separate from game state and frozen autoplay policy.
const ids = {
  story: "story-auto",
  skipDialogue: "skip-dialogue",
  fastForward: "fast-forward",
  autoBattle: "auto-battle",
  invincible: "invincible",
  showLocation: "show-location",
};
export async function openBrowserTools(page) {
  const touch = page.locator("[data-touch-toggle]");
  await touch.waitFor();
  if ((await touch.getAttribute("aria-pressed")) !== "true") await touch.click();
  if ((await page.locator("[data-touch-tools]").getAttribute("aria-expanded")) !== "true")
    await page.locator("[data-touch-tools]").click();
}
export async function setBrowserAssists(page, values, { close = true } = {}) {
  await openBrowserTools(page);
  for (const [key, enabled] of Object.entries(values)) {
    const button = page.locator("#" + ids[key]);
    if (((await button.getAttribute("aria-pressed")) === "true") !== enabled) {
      await button.click();
      await page.waitForFunction(
        ({ id, enabled }) =>
          document.getElementById(id)?.getAttribute("aria-pressed") === String(enabled),
        { id: ids[key], enabled },
      );
    }
  }
  if (close) await page.locator("#tools-close").click();
}
// Existing browser regression scenarios now drive the split public controls.
// The full boosted CLI regression and its battle policy remain unchanged.
export async function clickRegressionControl(page, label) {
  if (label === "剧情测试（强化队伍）" || label === "继续剧情测试") {
    const url = new URL(page.url());
    url.searchParams.set("regression", "boosted");
    if (url.href !== page.url()) await page.goto(url.href);
    await page
      .getByRole("button", {
        name: label === "继续剧情测试" ? "继续游戏" : "强化回归（开发）",
        exact: true,
      })
      .click();
    return;
  }
  if (label.startsWith("自动行走：")) {
    const on = label.endsWith("关");
    await setBrowserAssists(
      page,
      on
        ? { skipDialogue: true, fastForward: true, autoBattle: true, story: true }
        : { story: false },
    );
    return;
  }
  if (label.startsWith("自动推进：")) {
    const on = label.endsWith("关");
    await setBrowserAssists(page, { skipDialogue: on, fastForward: on, autoBattle: on });
    return;
  }
  throw Error(`Unknown former browser regression control: ${label}`);
}
