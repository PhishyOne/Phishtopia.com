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