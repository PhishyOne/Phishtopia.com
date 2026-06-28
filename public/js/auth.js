document.addEventListener("click", event => {
    const toggle = event.target.closest("[data-password-toggle]");
    if (!toggle) return;

    const targetId = toggle.getAttribute("data-password-toggle");
    const input = document.getElementById(targetId);
    if (!input) return;

    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";

    toggle.textContent = isHidden ? "🙈" : "👁";
    toggle.setAttribute(
        "aria-label",
        isHidden ? "Hide password" : "Show password"
    );
    toggle.setAttribute("aria-pressed", String(isHidden));
});
