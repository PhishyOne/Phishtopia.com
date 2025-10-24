
document.addEventListener("DOMContentLoaded", () => {
    const spinner = document.getElementById("loading");
    const form = document.getElementById("playerForm");

    // Show spinner on submit
    if (form) {
        form.addEventListener("submit", () => {
            if (spinner) spinner.style.display = "block";
        });
    }

    // Collapsible tree logic
    document.querySelectorAll(".tree .caret").forEach(caret => {
        caret.addEventListener("click", e => {
            const li = e.target.closest("li");
            if (!li) return;

            const nested = li.querySelector(":scope > .nested");
            if (!nested) return;

            const isExpanding = !nested.classList.contains("show");

            // Toggle this node
            nested.classList.toggle("show");
            caret.classList.toggle("caret-down");

            // Expand or collapse all descendants recursively
            nested.querySelectorAll(".nested").forEach(childNested => {
                if (isExpanding) {
                    childNested.classList.add("show");
                    const childCaret = childNested.parentElement.querySelector(":scope > .caret");
                    if (childCaret) childCaret.classList.add("caret-down");
                } else {
                    childNested.classList.remove("show");
                    const childCaret = childNested.parentElement.querySelector(":scope > .caret");
                    if (childCaret) childCaret.classList.remove("caret-down");
                }
            });
        });
    });
});

// Hide spinner if page is restored from cache
window.addEventListener("pageshow", () => {
    const spinner = document.getElementById("loading");
    if (spinner) spinner.style.display = "none";
});