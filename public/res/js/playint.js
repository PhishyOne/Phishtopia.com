
/* =======================
   Starfield Background 
   ======================= */
(() => {
    const canvas = document.getElementById('stars-bg');
    const ctx = canvas.getContext('2d', { alpha: true });
    let DPR = window.devicePixelRatio || 1;

    function resize() {
        canvas.width = innerWidth * DPR;
        canvas.height = innerHeight * DPR;
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    canvas.addEventListener('click', e => explode(e.clientX, e.clientY));

    const stars = Array.from({ length: 200 }, () => ({
        x: Math.random() * innerWidth,
        y: Math.random() * innerHeight,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random(),
        twinkle: Math.random() * 0.02 + 0.01
    }));

    const particles = [];

    function explode(x, y) {
        for (let i = 0; i < 30; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 2 + 1;
            particles.push({
                x, y,
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

        // stars
        for (const s of stars) {
            s.alpha += s.twinkle * (Math.random() > 0.5 ? 1 : -1);
            s.alpha = Math.min(Math.max(s.alpha, 0.3), 1);
            ctx.globalAlpha = s.alpha;
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();

            // occasional explosion
            if (Math.random() < 0.0002) explode(s.x, s.y);
        }

        // particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.02;
            p.life--;
            if (p.life <= 0) particles.splice(i, 1);
            else {
                ctx.globalAlpha = p.life / 60;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(loop);
    }
    loop();
})();

/* =======================
   Spinner and Collapsible Tree
   ======================= */
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

/* =================
   UTC Time Display
   ================= */
function updateUTCTime() {
    const now = new Date();
    const utcTime = now.toUTCString().split(' ')[4] + ' UTC';
    const el = document.getElementById('utc-time');
    if (el) el.textContent = utcTime;
}

document.addEventListener('DOMContentLoaded', () => {
    updateUTCTime();
    setInterval(updateUTCTime, 1000);
});

/* =================
    Filter Toggle
    ================= */
document.addEventListener('DOMContentLoaded', () => {
    const toggleFilters = document.getElementById('toggleFilters');
    const filtersRow = document.querySelector('.filters-row');
    const arrow = toggleFilters.querySelector('.toggle-arrow');

    // Start collapsed
    filtersRow.classList.remove('expanded');
    arrow.innerHTML = '&#9656;'; // right-pointing

    toggleFilters.addEventListener('click', () => {
        filtersRow.classList.toggle('expanded');
        arrow.innerHTML = filtersRow.classList.contains('expanded') ? '&#9662;' : '&#9656;';
    });
});
    