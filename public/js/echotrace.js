/* =======================
   Starfield Background
   ======================= */
(() => {
    const canvas = document.getElementById("stars-bg");
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    let DPR = window.devicePixelRatio || 1;

    function resize() {
        DPR = window.devicePixelRatio || 1;
        canvas.width = innerWidth * DPR;
        canvas.height = innerHeight * DPR;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    window.addEventListener("resize", resize);
    resize();

    canvas.addEventListener("click", event => explode(event.clientX, event.clientY));

    const stars = Array.from({ length: 200 }, () => ({
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random(),
        twinkle: Math.random() * 0.02 + 0.01
    }));

    const particles = [];

    function explode(x, y) {
        for (let i = 0; i < 30; i += 1) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 2 + 1;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 60,
                color: `hsl(${200 + Math.random() * 100}, 80%, 60%)`
            });
        }
    }

    function loop() {
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        ctx.fillStyle = "rgba(2,6,20,0.15)";
        ctx.fillRect(0, 0, innerWidth, innerHeight);

        for (const star of stars) {
            star.alpha += star.twinkle * (Math.random() > 0.5 ? 1 : -1);
            star.alpha = Math.min(Math.max(star.alpha, 0.3), 1);
            ctx.globalAlpha = star.alpha;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
            ctx.fill();

            if (Math.random() < 0.0002) explode(star.x, star.y);
        }

        for (let i = particles.length - 1; i >= 0; i -= 1) {
            const particle = particles[i];
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += 0.02;
            particle.life -= 1;

            if (particle.life <= 0) {
                particles.splice(i, 1);
            } else {
                ctx.globalAlpha = particle.life / 60;
                ctx.fillStyle = particle.color;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.globalAlpha = 1;
        requestAnimationFrame(loop);
    }

    loop();
})();

document.addEventListener("DOMContentLoaded", () => {
    const spinner = document.getElementById("loading");
    const form = document.getElementById("playerForm");

    form?.addEventListener("submit", () => {
        if (spinner) spinner.style.display = "block";
    });

    document.querySelectorAll(".tree .caret").forEach(caret => {
        caret.addEventListener("click", event => {
            const item = event.target.closest("li");
            if (!item) return;

            const nested = item.querySelector(":scope > .nested");
            if (!nested) return;

            const isExpanding = !nested.classList.contains("show");
            nested.classList.toggle("show");
            caret.classList.toggle("caret-down");

            nested.querySelectorAll(".nested").forEach(childNested => {
                const childCaret = childNested.parentElement.querySelector(":scope > .caret");
                childNested.classList.toggle("show", isExpanding);
                childCaret?.classList.toggle("caret-down", isExpanding);
            });
        });
    });

    const toggleFilters = document.getElementById("toggleFilters");
    const filtersRow = document.querySelector(".filters-row");
    const arrow = toggleFilters?.querySelector(".toggle-arrow");

    if (toggleFilters && filtersRow && arrow) {
        filtersRow.classList.remove("expanded");
        arrow.innerHTML = "&#9656;";

        toggleFilters.addEventListener("click", () => {
            filtersRow.classList.toggle("expanded");
            arrow.innerHTML = filtersRow.classList.contains("expanded") ? "&#9662;" : "&#9656;";
        });
    }

    function updateUTCTime() {
        const element = document.getElementById("utc-time");
        if (element) element.textContent = `${new Date().toUTCString().split(" ")[4]} UTC`;
    }

    updateUTCTime();
    setInterval(updateUTCTime, 1000);
});

window.addEventListener("pageshow", () => {
    const spinner = document.getElementById("loading");
    if (spinner) spinner.style.display = "none";
});
