const form = document.getElementById("login"),
  status = document.getElementById("status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  status.textContent = "正在登录…";
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: form.elements.password.value }),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    localStorage.removeItem("ffvi-recovery-active");
    form.reset();
    location.replace("/");
  } catch (error) {
    status.textContent = error.message || "暂时无法连接，请稍后重试";
    button.disabled = false;
  }
});
document.getElementById("recover")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    button = form.querySelector("button");
  button.disabled = true;
  try {
    const recoveryKey = form.elements.recoveryKey.value.trim();
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recoveryKey }),
    });
    const value = await response.json();
    if (!response.ok) throw Error(value.error);
    localStorage.setItem("ffvi-recovery-active", recoveryKey);
    localStorage.setItem(`ffvi-recovery:${value.serverId}`, recoveryKey);
    form.reset();
    location.replace("/");
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
