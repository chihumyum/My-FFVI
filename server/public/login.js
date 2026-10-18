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
    form.reset();
    location.replace("/");
  } catch (error) {
    status.textContent = error.message || "暂时无法连接，请稍后重试";
    button.disabled = false;
  }
});
